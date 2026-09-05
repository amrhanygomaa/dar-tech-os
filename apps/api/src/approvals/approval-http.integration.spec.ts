import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiConfig } from "@dar-tech/config";
import { createPrismaClient, type DatabaseClient } from "@dar-tech/database";
import { RequestContextStore, StructuredLogger } from "@dar-tech/observability";
import { AppModule } from "../app.module.js";
import { AuthorizationActorContext } from "../authorization/authorization-context.js";
import type { AuthorizationActor } from "../authorization/authorization.contracts.js";
import { ApprovalService } from "./approval.service.js";
import type {
  ApprovalPolicy,
  ApprovalRequestView,
} from "./approval.contracts.js";
import { runInTransaction } from "@dar-tech/database";
import { PERMISSION_REGISTRY } from "../permissions/permission-manifest.js";
import type { ScopeType } from "../permissions/permission.contracts.js";
import { configureApiFoundation } from "../platform/configure-api-foundation.js";
import { SessionService } from "../sessions/session.service.js";
import { AuthorizationService } from "../authorization/authorization.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const now = new Date("2026-09-03T12:00:00.000Z");
const organizationAId = "018f53d4-2f68-7c52-a399-3df2364df001";
const organizationBId = "018f53d4-2f68-7c52-a399-3df2364df002";
const actorEmployeeId = "018f53d4-2f68-7c52-a399-3df2364df011";
const targetEmployeeId = "018f53d4-2f68-7c52-a399-3df2364df012";
const foreignEmployeeId = "018f53d4-2f68-7c52-a399-3df2364df013";
const actorAccountId = "018f53d4-2f68-7c52-a399-3df2364df021";
const foreignAccountId = "018f53d4-2f68-7c52-a399-3df2364df022";
const sessionId = "018f53d4-2f68-7c52-a399-3df2364df031";
const credential = Buffer.alloc(32, 19).toString("base64url");
const credentialHash = createHash("sha256").update(credential).digest("hex");

const config: ApiConfig = {
  runtime: "api",
  appEnvironment: "test",
  nodeEnvironment: "test",
  logLevel: "error",
  port: 3001,
  databaseUrl: databaseUrl ?? "postgresql://test:test@127.0.0.1:5432/test",
  databasePoolMax: 8,
  databaseConnectTimeoutMs: 2_000,
  databaseIdleTimeoutMs: 2_000,
  authentication: {
    allowedRedirectUris: ["http://localhost:3000/auth/callback/local"],
    localProviderEnabled: false,
    localIdentities: [],
    transactionTtlSeconds: 300,
  },
  invitation: {
    ttlSeconds: 300,
    rateLimitMaxRequests: 100,
    rateLimitWindowSeconds: 60,
  },
  session: {
    idleTtlSeconds: 300,
    absoluteTtlSeconds: 3600,
    allowedOrigins: ["http://localhost:3000"],
    secureCookie: false,
  },
};

async function clearData(client: DatabaseClient): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE TABLE "approval_history_entries", "approval_steps", "approval_requests", "audit_events", "security_events", "sessions", "role_permissions", "employee_roles", "permissions", "roles", "invitations", "sso_identities", "user_accounts", "employees", "organizations"',
  );
  await client.outboxConsumerReceipt.deleteMany();
  await client.outboxEvent.deleteMany();
  await client.queueJob.deleteMany();
}

describe.skipIf(!databaseUrl)(
  "S02-T09 approval HTTP and owning-command PostgreSQL integration",
  () => {
    let client: DatabaseClient;
    let app: INestApplication;
    let roleId: string;
    let allowApprover = true;
    let planAvailable = true;
    let currentPolicy: ApprovalPolicy;
    let decisionStepUp = false;

    beforeAll(async () => {
      client = createPrismaClient({ databaseUrl: databaseUrl as string });
      const contextStore = new RequestContextStore();
      const logger = new StructuredLogger(contextStore, {
        runtime: "api",
        environment: "test",
        level: "error",
        destination: new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      });
      app = await NestFactory.create(
        AppModule.register(
          config,
          { contextStore, logger },
          {
            sessionTestAdapters: { clock: { now: () => now } },
            authorizationTestAdapters: {
              clock: { now: () => now },
              approvalPolicyResolver: {
                resolvePolicy: async (input) =>
                  input.action === "admin.employee.suspend"
                    ? currentPolicy
                    : decisionStepUp &&
                        input.action === "approval.request.approve"
                      ? {
                          policyKey: "test.decision-stepup",
                          policyVersion: 1,
                          risk: input.risk,
                          outcome: "STEP_UP_ONLY",
                          stepUpRequirement: {
                            assuranceLevel: "mfa",
                            maximumAgeSeconds: 60,
                          },
                        }
                      : {
                          policyKey: "compatibility.no-approval",
                          policyVersion: 1,
                          risk: input.risk,
                          outcome: "NO_APPROVAL",
                        },
              },
            },
            approvalApproverTestAdapter: {
              validatePlan: async () => planAvailable,
              actorMatches: async ({ actor }) =>
                allowApprover && actor.employeeId === actorEmployeeId,
            },
          },
        ),
        { logger },
      );
      configureApiFoundation(
        app,
        contextStore,
        logger,
        config.session.allowedOrigins,
      );
      await app.init();
    });

    beforeEach(async () => {
      allowApprover = true;
      planAvailable = true;
      decisionStepUp = false;
      currentPolicy = {
        policyKey: "test.owning-command",
        policyVersion: 1,
        risk: "HIGH",
        outcome: "SINGLE_APPROVER",
        steps: [
          {
            sequence: 1,
            approverSubject: { type: "ROLE", key: "test.reviewer" },
            separationRule: "NONE",
          },
        ],
      };
      await clearData(client);
      await client.organization.createMany({
        data: [
          { id: organizationAId, displayName: "Organization A" },
          { id: organizationBId, displayName: "Organization B" },
        ],
      });
      await client.employee.createMany({
        data: [
          {
            id: actorEmployeeId,
            organizationId: organizationAId,
            employeeCode: "A-ACTOR",
            firstName: "Actor",
            lastName: "Employee",
            displayName: "Actor Employee",
            workEmail: "actor@example.com",
            lifecycleStatus: "ACTIVE",
            activatedAt: now,
          },
          {
            id: targetEmployeeId,
            organizationId: organizationAId,
            employeeCode: "A-TARGET",
            firstName: "Target",
            lastName: "Employee",
            displayName: "Target Employee",
            workEmail: "target@example.com",
            lifecycleStatus: "ACTIVE",
            activatedAt: now,
          },
          {
            id: foreignEmployeeId,
            organizationId: organizationBId,
            employeeCode: "B-TARGET",
            firstName: "Foreign",
            lastName: "Employee",
            displayName: "Foreign Employee",
            workEmail: "foreign@example.com",
            lifecycleStatus: "ACTIVE",
            activatedAt: now,
          },
        ],
      });
      await client.userAccount.createMany({
        data: [
          {
            id: actorAccountId,
            organizationId: organizationAId,
            employeeId: actorEmployeeId,
            authenticationEligible: true,
            activatedAt: now,
          },
          {
            id: foreignAccountId,
            organizationId: organizationBId,
            employeeId: foreignEmployeeId,
            authenticationEligible: true,
            activatedAt: now,
          },
        ],
      });
      await client.permission.createMany({
        data: PERMISSION_REGISTRY.map((definition) => ({ ...definition })),
      });
      const role = await client.role.create({
        data: {
          organizationId: organizationAId,
          key: "operator",
          name: "Operator",
          normalizedName: "operator",
        },
      });
      roleId = role.id;
      const assignment = await client.employeeRole.create({
        data: {
          organizationId: organizationAId,
          employeeId: actorEmployeeId,
          roleId,
          assignedByEmployeeId: actorEmployeeId,
          assignedAt: now,
          effectiveAt: now,
        },
      });
      expect(assignment.id).toBeTruthy();
      await client.session.create({
        data: {
          id: sessionId,
          organizationId: organizationAId,
          employeeId: actorEmployeeId,
          userAccountId: actorAccountId,
          credentialHash,
          issuedAt: now,
          authenticatedAt: now,
          lastSeenAt: now,
          idleExpiresAt: new Date(now.getTime() + 300_000),
          absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
          assuranceLevel: "mfa",
        },
      });
    });

    afterAll(async () => {
      if (client) await clearData(client);
      if (app) await app.close();
      if (client) await client.$disconnect();
    });

    async function grant(
      permissionKey: string,
      scopeType: ScopeType = "ORGANIZATION",
      binding?: { type: string; id: string },
    ) {
      const permission = await client.permission.findUniqueOrThrow({
        where: { key: permissionKey },
      });
      return client.rolePermission.create({
        data: {
          organizationId: organizationAId,
          roleId,
          permissionId: permission.id,
          scopeType,
          scopeBindingType: binding?.type ?? null,
          scopeBindingId: binding?.id ?? null,
          grantedByEmployeeId: actorEmployeeId,
          grantedAt: now,
          effectiveAt: now,
        },
      });
    }

    function get(path: string) {
      return request(app.getHttpServer())
        .get(path)
        .set("Cookie", `dartech_session=${credential}`);
    }

    async function trusted<T>(
      work: (actor: AuthorizationActor) => Promise<T>,
    ): Promise<T> {
      const resolution = await app
        .get(SessionService)
        .requirePrincipal({ status: "present", credential });
      const actor = { ...resolution.principal, actorType: "employee" as const };
      return app.get(AuthorizationActorContext).run(actor, () => work(actor));
    }

    async function prepare(
      key = "technical-command",
    ): Promise<ApprovalRequestView> {
      const result = await trusted((actor) =>
        app.get(ApprovalService).prepareApprovalForAction({
          actor,
          action: "admin.employee.suspend",
          resource: {
            type: "employee",
            organizationId: organizationAId,
            id: targetEmployeeId,
          },
          risk: "HIGH",
          safeContext: { revision: 1 },
          requesterSnapshot: { displayName: "Actor Employee" },
          resourceSnapshot: { displayName: "Target Employee" },
          safeReason: "Technical fixture",
          correlationId: "test-correlation",
          idempotencyMaterial: key,
          at: now,
        }),
      );
      if (result.outcome !== "APPROVAL_REQUIRED")
        throw new Error("Expected approval");
      return result.request;
    }

    function postDecision(
      id: string,
      stepId: string,
      decision = "approve",
      extra = {},
    ) {
      return request(app.getHttpServer())
        .post("/api/v1/approvals/" + id + "/" + decision)
        .set("Cookie", "dartech_session=" + credential)
        .set("Origin", "http://localhost:3000")
        .send({ stepId, expectedVersion: 1, ...extra });
    }

    async function approvedRequest() {
      await grant("admin.employee.suspend");
      await grant("approval.request.approve");
      const result = await prepare();
      await postDecision(result.id, result.steps[0]!.id).expect(200);
      return result;
    }

    async function claim(id: string, changes: Record<string, unknown> = {}) {
      return trusted((actor) =>
        app.get(ApprovalService).claimApprovedAction({
          actor,
          approvalReference: id,
          action: "admin.employee.suspend",
          resource: {
            type: "employee",
            organizationId: organizationAId,
            id: targetEmployeeId,
          },
          risk: "HIGH",
          safeContext: { revision: 1 },
          correlationId: "test-execution",
          at: now,
          ...changes,
        }),
      );
    }

    it("requires current base permission and denies out-of-context preparation", async () => {
      await expect(prepare()).rejects.toMatchObject({
        code: "AUTHORIZATION_DENIED",
      });
      await grant("admin.employee.suspend");
      const result = await prepare();
      expect(result.status).toBe("PENDING");
      expect(await client.approvalRequest.count()).toBe(1);
      await trusted(async (actor) => {
        await expect(
          app.get(ApprovalService).prepareApprovalForAction({
            actor: { ...actor, employeeId: foreignEmployeeId },
            action: "admin.employee.suspend",
            resource: {
              type: "employee",
              organizationId: organizationAId,
              id: targetEmployeeId,
            },
            risk: "HIGH",
            safeContext: {},
            requesterSnapshot: {},
            correlationId: "test",
            idempotencyMaterial: "forged",
            at: now,
          }),
        ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
      });
    });

    it("requires permission AND current approver resolution; UI exposes only permitted decisions", async () => {
      await grant("admin.employee.suspend");
      await grant("approval.request.read");
      const result = await prepare();
      let detail = await get("/api/v1/approvals/" + result.id).expect(200);
      expect(detail.body.data.steps[0]).toMatchObject({
        actionable: false,
        canApprove: false,
        canReject: false,
      });
      await postDecision(result.id, result.steps[0]!.id).expect(403);
      await grant("approval.request.approve");
      allowApprover = false;
      await postDecision(result.id, result.steps[0]!.id).expect(404);
      await postDecision(result.id, result.steps[0]!.id, "approve", {
        expectedVersion: 2,
      }).expect(404);
      detail = await get("/api/v1/approvals/" + result.id).expect(200);
      expect(detail.body.data.steps[0].actionable).toBe(false);
      allowApprover = true;
      detail = await get("/api/v1/approvals/" + result.id).expect(200);
      expect(detail.body.data.steps[0]).toMatchObject({
        actionable: true,
        canApprove: true,
        canReject: false,
      });
      await postDecision(result.id, result.steps[0]!.id, "reject").expect(403);
      await postDecision(result.id, result.steps[0]!.id).expect(200);
      await postDecision(result.id, result.steps[0]!.id).expect(404);
      expect(
        await client.auditEvent.count({
          where: { approvalReference: result.id },
        }),
      ).toBe(1);
    });

    it("filters list totals and prevents cross-org / scoped-list enumeration", async () => {
      await grant("admin.employee.suspend");
      await grant("approval.request.read");
      const result = await prepare();
      expect(
        (await get("/api/v1/approvals?status=PENDING&risk=HIGH").expect(200))
          .body.data.total,
      ).toBe(1);
      expect(
        (await get("/api/v1/approvals?status=REJECTED").expect(200)).body.data
          .total,
      ).toBe(0);
      await get("/api/v1/approvals?status=DRAFT").expect(422);
      const foreign = await client.approvalRequest.create({
        data: {
          organizationId: organizationBId,
          requesterEmployeeId: foreignEmployeeId,
          requesterSnapshot: { displayName: "Private" },
          actionKey: "admin.employee.suspend",
          resourceType: "employee",
          risk: "HIGH",
          policyKey: "test.foreign",
          policyVersion: 1,
          policyOutcome: "SINGLE_APPROVER",
          policyFingerprint: "f".repeat(64),
          contextFingerprint: "f".repeat(64),
          serverContextSnapshot: {},
          status: "PENDING",
          correlationId: "foreign",
          idempotencyDigest: "f".repeat(64),
        },
      });
      await get("/api/v1/approvals/" + foreign.id).expect(404);
      expect((await get("/api/v1/approvals").expect(200)).body.data.total).toBe(
        1,
      );
      await client.rolePermission.updateMany({
        data: { removedAt: now, removedByEmployeeId: actorEmployeeId },
      });
      await grant("approval.request.read", "EXPLICIT", {
        type: "approval-request",
        id: result.id,
      });
      await get("/api/v1/approvals/" + result.id).expect(200);
      await get("/api/v1/approvals").expect(403);
      await get("/api/v1/approvals/" + foreign.id).expect(403);
    });

    it("rejects client policy/subject/evidence authoring and generic endpoints", async () => {
      await grant("admin.employee.suspend");
      await grant("approval.request.approve");
      const result = await prepare();
      for (const extra of [
        { policyOutcome: "NO_APPROVAL" },
        { approverSubjectKey: "test.reviewer" },
        { lastStepUpAt: now.toISOString() },
      ]) {
        await postDecision(
          result.id,
          result.steps[0]!.id,
          "approve",
          extra,
        ).expect(422);
      }
      for (const path of [
        "/api/v1/approvals",
        "/api/v1/approvals/" + result.id + "/execute",
        "/api/v1/approvals/" + result.id + "/request-changes",
      ]) {
        await request(app.getHttpServer())
          .post(path)
          .set("Cookie", "dartech_session=" + credential)
          .set("Origin", "http://localhost:3000")
          .send({})
          .expect(404);
      }
      expect(await client.approvalHistoryEntry.count()).toBe(1);
    });

    it("uses explicit separation and current employee lifecycle without role-name shortcuts", async () => {
      await grant("admin.employee.suspend");
      await grant("approval.request.approve");
      currentPolicy = {
        ...currentPolicy,
        steps: [
          {
            ...currentPolicy.steps![0]!,
            separationRule: "REQUESTER_DIFFERENT_EMPLOYEE",
          },
        ],
      };
      const result = await prepare();
      await client.role.update({
        where: { id: roleId },
        data: { name: "Founder", normalizedName: "founder" },
      });
      await postDecision(result.id, result.steps[0]!.id).expect(404);
      await client.employee.update({
        where: { id: actorEmployeeId },
        data: { lifecycleStatus: "SUSPENDED" },
      });
      await postDecision(result.id, result.steps[0]!.id).expect(401);
    });

    it("resolves STEP_UP_REQUIRED from T04 and never accepts supplied assurance metadata", async () => {
      await grant("admin.employee.suspend");
      await grant("approval.request.approve");
      const result = await prepare();
      decisionStepUp = true;
      const denied = await postDecision(result.id, result.steps[0]!.id).expect(
        403,
      );
      expect(denied.body.error.code).toBe("STEP_UP_REQUIRED");
      await client.session.update({
        where: { id: sessionId },
        data: { lastStepUpAt: now },
      });
      await postDecision(result.id, result.steps[0]!.id).expect(200);
    });

    it("rolls back preparation when configured policy or subject resolution fails", async () => {
      await grant("admin.employee.suspend");
      planAvailable = false;
      await expect(prepare()).rejects.toThrow();
      expect(await client.approvalRequest.count()).toBe(0);
      expect(await client.approvalStep.count()).toBe(0);
      expect(await client.approvalHistoryEntry.count()).toBe(0);
      expect(await client.outboxEvent.count()).toBe(0);
      currentPolicy = { ...currentPolicy, steps: [] };
      await expect(prepare()).rejects.toThrow();
      expect(await client.approvalRequest.count()).toBe(0);
    });

    it("rejects forged, cross-org, wrong action/resource, stale context and changed policy at execution", async () => {
      const result = await approvedRequest();
      for (const changes of [
        { approvalReference: foreignEmployeeId },
        { action: "admin.employee.offboard", risk: "CRITICAL" },
        {
          resource: {
            type: "employee",
            organizationId: organizationAId,
            id: actorEmployeeId,
          },
        },
        {
          resource: {
            type: "employee",
            organizationId: organizationBId,
            id: foreignEmployeeId,
          },
        },
        { safeContext: { revision: 2 } },
      ])
        expect(await claim(result.id, changes)).toEqual({ status: "denied" });
      currentPolicy = { ...currentPolicy, policyVersion: 2 };
      expect(await claim(result.id)).toEqual({ status: "denied" });
      expect(
        (
          await client.approvalRequest.findUniqueOrThrow({
            where: { id: result.id },
          })
        ).executionState,
      ).toBe("READY");
    });

    it.each(["permission", "scope", "role"] as const)(
      "denies execution when current %s authority is removed after approval",
      async (kind) => {
        const result = await approvedRequest();
        if (kind === "permission")
          await client.rolePermission.updateMany({
            data: { removedAt: now, removedByEmployeeId: actorEmployeeId },
          });
        if (kind === "scope")
          await client.rolePermission.updateMany({
            data: {
              scopeType: "EXPLICIT",
              scopeBindingType: "employee",
              scopeBindingId: foreignEmployeeId,
            },
          });
        if (kind === "role")
          await client.employeeRole.updateMany({
            data: { removedAt: now, removedByEmployeeId: actorEmployeeId },
          });
        expect(await claim(result.id)).toEqual({ status: "denied" });
        expect(
          (
            await client.approvalRequest.findUniqueOrThrow({
              where: { id: result.id },
            })
          ).executionState,
        ).toBe("READY");
      },
    );

    it("denies stale step-up at execution even with forged fresh caller metadata", async () => {
      currentPolicy = {
        ...currentPolicy,
        outcome: "STEP_UP_AND_APPROVAL",
        stepUpRequirement: { assuranceLevel: "mfa", maximumAgeSeconds: 60 },
      };
      await client.session.update({
        where: { id: sessionId },
        data: { lastStepUpAt: now },
      });
      const result = await approvedRequest();
      await client.session.update({
        where: { id: sessionId },
        data: { lastStepUpAt: new Date(now.getTime() - 61_000) },
      });
      expect(await claim(result.id)).toEqual({ status: "denied" });
      await trusted(async (actor) => {
        expect(
          await app.get(AuthorizationService).authorize(
            { ...actor, lastStepUpAt: now },
            "admin.employee.suspend",
            {
              type: "employee",
              organizationId: organizationAId,
              id: targetEmployeeId,
            },
            {
              at: now,
              source: "application",
              approvalReference: result.id,
              approvalContext: { revision: 1 },
            },
          ),
        ).toMatchObject({ allowed: false, reasonCode: "STEP_UP_REQUIRED" });
      });
    });

    it("claims concurrently at most once and returns only an exact reauthorized stable result", async () => {
      const result = await approvedRequest();
      expect(
        (
          await client.employee.findUniqueOrThrow({
            where: { id: targetEmployeeId },
          })
        ).displayName,
      ).toBe("Target Employee");
      const claims = await Promise.all([claim(result.id), claim(result.id)]);
      const winner = claims.find((item) => item.status === "claimed");
      expect(claims.filter((item) => item.status === "claimed")).toHaveLength(
        1,
      );
      if (!winner || winner.status !== "claimed")
        throw new Error("Expected one winner");
      await runInTransaction(client, async (transaction) => {
        await transaction.employee.update({
          where: { id: targetEmployeeId },
          data: { displayName: "Technical mutation" },
        });
        await app.get(ApprovalService).completeApprovedAction(
          {
            organizationId: organizationAId,
            approvalReference: result.id,
            claimVersion: winner.claimVersion,
            resultReference: "technical-result",
            correlationId: "test-execution",
            at: now,
          },
          transaction,
        );
      });
      expect(await claim(result.id)).toEqual({
        status: "already_succeeded",
        resultReference: "technical-result",
      });
      expect(await claim(result.id, { safeContext: { revision: 2 } })).toEqual({
        status: "denied",
      });
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.approved-action-executed" },
        }),
      ).toBe(1);
      expect(
        await client.auditEvent.count({
          where: { approvalReference: result.id },
        }),
      ).toBe(2);
      await client.rolePermission.updateMany({
        data: { removedAt: now, removedByEmployeeId: actorEmployeeId },
      });
      expect(await claim(result.id)).toEqual({ status: "denied" });
    });

    it("handles concurrent preparation without duplicate steps, history or requested events", async () => {
      await grant("admin.employee.suspend");
      const results = await Promise.all([prepare(), prepare(), prepare()]);
      expect(new Set(results.map((item) => item.id)).size).toBe(1);
      expect(await client.approvalRequest.count()).toBe(1);
      expect(await client.approvalStep.count()).toBe(1);
      expect(await client.approvalHistoryEntry.count()).toBe(1);
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.approval-requested" },
        }),
      ).toBe(1);
    });

    it("serializes execution success/failure finalization and rolls back the losing owning mutation", async () => {
      const result = await approvedRequest();
      const winner = await claim(result.id);
      if (winner.status !== "claimed") throw new Error("Expected claim");
      const completion = {
        organizationId: organizationAId,
        approvalReference: result.id,
        claimVersion: winner.claimVersion,
        correlationId: "test-finalize",
        at: now,
      };
      const finalizations = await Promise.allSettled([
        runInTransaction(client, async (transaction) => {
          await transaction.employee.update({
            where: { id: targetEmployeeId },
            data: { displayName: "Completed mutation" },
          });
          await app
            .get(ApprovalService)
            .completeApprovedAction(
              { ...completion, resultReference: "technical-success" },
              transaction,
            );
        }),
        runInTransaction(client, async (transaction) => {
          await app
            .get(ApprovalService)
            .failApprovedAction(
              { ...completion, safeFailureCode: "OWNING_MUTATION_FAILED" },
              transaction,
            );
        }),
      ]);
      expect(
        finalizations.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
      const stored = await client.approvalRequest.findUniqueOrThrow({
        where: { id: result.id },
      });
      expect(["SUCCEEDED", "FAILED"]).toContain(stored.executionState);
      expect(
        (
          await client.employee.findUniqueOrThrow({
            where: { id: targetEmployeeId },
          })
        ).displayName,
      ).toBe(
        stored.executionState === "SUCCEEDED"
          ? "Completed mutation"
          : "Target Employee",
      );
      expect(
        await client.approvalHistoryEntry.count({
          where: {
            approvalRequestId: result.id,
            category: { in: ["EXECUTION_SUCCEEDED", "EXECUTION_FAILED"] },
          },
        }),
      ).toBe(1);
      expect(
        await client.outboxEvent.count({
          where: {
            eventType: {
              in: [
                "identity.approved-action-executed",
                "identity.approved-action-execution-failed",
              ],
            },
          },
        }),
      ).toBe(1);
    });

    it("proves sequential groups, invalid step selection/version, terminal rejection, and rejection events", async () => {
      await grant("admin.employee.suspend");
      await grant("approval.request.approve");
      await grant("approval.request.reject");
      const step = currentPolicy.steps![0]!;
      currentPolicy = {
        ...currentPolicy,
        outcome: "SEQUENTIAL_APPROVAL",
        steps: [
          step,
          { ...step, approverSubject: { type: "ROLE", key: "test.other" } },
          { ...step, sequence: 2 },
        ],
      };
      const result = await prepare();
      const current = result.steps.filter((item) => item.sequence === 1);
      const future = result.steps.find((item) => item.sequence === 2)!;
      await postDecision(result.id, foreignEmployeeId).expect(404);
      await postDecision(result.id, current[0]!.id, "approve", {
        expectedVersion: 2,
      }).expect(409);
      await postDecision(result.id, future.id).expect(404);
      await postDecision(result.id, current[0]!.id).expect(200);
      await postDecision(result.id, future.id).expect(404);
      await postDecision(result.id, current[1]!.id, "reject").expect(200);
      await postDecision(result.id, future.id).expect(404);
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.approval-rejected" },
        }),
      ).toBe(1);
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.approval-step-approved" },
        }),
      ).toBe(1);
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.approval-completed" },
        }),
      ).toBe(0);
    });
  },
);
