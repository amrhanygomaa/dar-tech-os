import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  runInTransaction,
  type DatabaseClient,
} from "@dar-tech/database";
import type { AuthorizationActor } from "../authorization/authorization.contracts.js";
import { approvalFingerprint } from "./approval-policy.js";
import { PrismaApprovalRepository } from "./prisma-approval.repository.js";
import type { ValidatedApprovalPolicy } from "./approval.contracts.js";
import {
  PrismaAuditEventRepository,
  PrismaEventHistoryRepository,
} from "../event-history/prisma-event-history.repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const organizationA = "018f53d4-2f68-7c52-a399-3df2364df101";
const organizationB = "018f53d4-2f68-7c52-a399-3df2364df102";
const employeeA = "018f53d4-2f68-7c52-a399-3df2364df111";
const employeeB = "018f53d4-2f68-7c52-a399-3df2364df112";
const at = new Date("2026-09-05T12:00:00.000Z");

describe.skipIf(!databaseUrl)("S02-T09 approval PostgreSQL constraints", () => {
  let client: DatabaseClient;
  beforeAll(() => {
    client = createPrismaClient({ databaseUrl: databaseUrl as string });
  });
  afterAll(async () => {
    await client.$executeRawUnsafe(
      'TRUNCATE TABLE "approval_history_entries", "approval_steps", "approval_requests"',
    );
    await client.$disconnect();
  });
  beforeEach(async () => {
    await client.$executeRawUnsafe(
      'TRUNCATE TABLE "approval_history_entries", "approval_steps", "approval_requests", "audit_events", "security_events", "sessions", "role_permissions", "employee_roles", "permissions", "roles", "invitations", "sso_identities", "user_accounts", "employees", "organizations", "outbox_consumer_receipts", "outbox_events", "queue_jobs"',
    );
    await client.organization.createMany({
      data: [
        { id: organizationA, displayName: "A" },
        { id: organizationB, displayName: "B" },
      ],
    });
    await client.employee.createMany({
      data: [
        {
          id: employeeA,
          organizationId: organizationA,
          employeeCode: "A",
          firstName: "A",
          lastName: "Actor",
          displayName: "A Actor",
          workEmail: "a@example.test",
          lifecycleStatus: "ACTIVE",
          activatedAt: at,
        },
        {
          id: employeeB,
          organizationId: organizationB,
          employeeCode: "B",
          firstName: "B",
          lastName: "Actor",
          displayName: "B Actor",
          workEmail: "b@example.test",
          lifecycleStatus: "ACTIVE",
          activatedAt: at,
        },
      ],
    });
    await client.userAccount.create({
      data: {
        id: actor.userAccountId,
        organizationId: organizationA,
        employeeId: employeeA,
        authenticationEligible: true,
        activatedAt: at,
      },
    });
    await client.session.create({
      data: {
        id: actor.sessionId,
        organizationId: organizationA,
        employeeId: employeeA,
        userAccountId: actor.userAccountId,
        credentialHash: "e".repeat(64),
        issuedAt: at,
        authenticatedAt: at,
        lastSeenAt: at,
        idleExpiresAt: actor.idleExpiresAt,
        absoluteExpiresAt: actor.absoluteExpiresAt,
        assuranceLevel: "mfa",
        lastStepUpAt: at,
      },
    });
  });

  async function createRequest() {
    return client.approvalRequest.create({
      data: {
        organizationId: organizationA,
        requesterEmployeeId: employeeA,
        requesterSnapshot: { displayName: "A Actor" },
        actionKey: "admin.employee.suspend",
        resourceType: "employee",
        resourceId: employeeA,
        serverContextSnapshot: { revision: 1 },
        contextFingerprint: "a".repeat(64),
        risk: "HIGH",
        policyKey: "test.policy",
        policyVersion: 1,
        policyOutcome: "SINGLE_APPROVER",
        policyFingerprint: "b".repeat(64),
        status: "PENDING",
        correlationId: "018f53d4-2f68-7c52-a399-3df2364df199",
        idempotencyDigest: "c".repeat(64),
      },
    });
  }

  function repository() {
    const audit = new PrismaAuditEventRepository(
      new PrismaEventHistoryRepository(
        client,
        {
          recordWrite: () => undefined,
          recordVolume: () => undefined,
        } as never,
        { info: () => undefined, errorEvent: () => undefined } as never,
      ),
    );
    return new PrismaApprovalRepository(
      client,
      {
        validatePlan: async () => true,
        actorMatches: async ({ actor: current }) =>
          current.employeeId === employeeA,
      },
      audit,
      { authorize: async () => ({ allowed: true }) } as never,
    );
  }

  const actor: AuthorizationActor = {
    actorType: "employee",
    sessionId: "018f53d4-2f68-7c52-a399-3df2364df131",
    organizationId: organizationA,
    employeeId: employeeA,
    userAccountId: "018f53d4-2f68-7c52-a399-3df2364df121",
    clientKind: "browser",
    assuranceLevel: "mfa",
    authenticatedAt: at,
    lastStepUpAt: at,
    issuedAt: at,
    lastSeenAt: at,
    idleExpiresAt: new Date(at.getTime() + 60_000),
    absoluteExpiresAt: new Date(at.getTime() + 600_000),
  };
  const sequentialPolicy: ValidatedApprovalPolicy = {
    policyKey: "test.sequential",
    policyVersion: 1,
    outcome: "SEQUENTIAL_APPROVAL",
    risk: "HIGH",
    steps: [
      {
        sequence: 1,
        approverSubject: { type: "EMPLOYEE", key: "employee.a" },
        separationRule: "NONE",
      },
      {
        sequence: 1,
        approverSubject: { type: "ROLE", key: "reviewer.a" },
        separationRule: "NONE",
      },
      {
        sequence: 2,
        approverSubject: { type: "RELATIONSHIP", key: "resource.owner" },
        separationRule: "NONE",
      },
    ],
    fingerprint: "d".repeat(64),
  };
  const prepareInput = {
    actor,
    action: "admin.employee.suspend",
    resource: {
      type: "employee" as const,
      organizationId: organizationA,
      id: employeeA,
    },
    risk: "HIGH" as const,
    safeContext: { revision: 1 },
    requesterSnapshot: { displayName: "A Actor" },
    resourceSnapshot: { displayName: "Target" },
    safeReason: "Technical fixture",
    correlationId: "018f53d4-2f68-7c52-a399-3df2364df198",
    idempotencyMaterial: "technical-command-1",
    at,
  };

  it("enforces organization-composite child relations and request idempotency", async () => {
    const request = await createRequest();
    await expect(
      client.approvalStep.create({
        data: {
          organizationId: organizationB,
          approvalRequestId: request.id,
          sequence: 1,
          approverSubjectType: "ROLE",
          approverSubjectKey: "reviewer",
          separationRule: "NONE",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(createRequest()).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects approval history UPDATE and DELETE at the database boundary", async () => {
    const request = await createRequest();
    const history = await client.approvalHistoryEntry.create({
      data: {
        organizationId: organizationA,
        approvalRequestId: request.id,
        actorEmployeeId: employeeA,
        category: "REQUESTED",
        requestStatus: "PENDING",
        executionState: "NOT_READY",
        correlationId: request.correlationId,
        occurredAt: at,
      },
    });
    await expect(
      client.approvalHistoryEntry.update({
        where: { id: history.id },
        data: { safeReason: "changed" },
      }),
    ).rejects.toThrow(/append-only/u);
    await expect(
      client.approvalHistoryEntry.delete({ where: { id: history.id } }),
    ).rejects.toThrow(/append-only/u);
  });

  it("creates atomically/idempotently and enforces parallel groups before the next sequence", async () => {
    const repo = repository();
    const first = await repo.prepare(prepareInput, sequentialPolicy);
    const replay = await repo.prepare(prepareInput, sequentialPolicy);
    expect(replay.id).toBe(first.id);
    expect(await client.approvalRequest.count()).toBe(1);
    expect(await client.approvalStep.count()).toBe(3);
    expect(await client.approvalHistoryEntry.count()).toBe(1);
    expect(
      await client.outboxEvent.count({
        where: { eventType: "identity.approval-requested" },
      }),
    ).toBe(1);
    const [parallelA, parallelB, future] = first.steps;
    expect(
      await repo.decide({
        actor,
        requestId: first.id,
        stepId: future!.id,
        expectedVersion: 1,
        decision: "APPROVED",
        safeReason: null,
        correlationId: prepareInput.correlationId,
        at,
      }),
    ).toBe("not_eligible");
    expect(
      await repo.decide({
        actor,
        requestId: first.id,
        stepId: parallelA!.id,
        expectedVersion: 1,
        decision: "APPROVED",
        safeReason: null,
        correlationId: prepareInput.correlationId,
        at,
      }),
    ).toBe("changed");
    expect((await repo.findById(organizationA, first.id))?.status).toBe(
      "IN_REVIEW",
    );
    expect(
      await repo.decide({
        actor,
        requestId: first.id,
        stepId: future!.id,
        expectedVersion: 1,
        decision: "APPROVED",
        safeReason: null,
        correlationId: prepareInput.correlationId,
        at,
      }),
    ).toBe("not_eligible");
    expect(
      await repo.decide({
        actor,
        requestId: first.id,
        stepId: parallelB!.id,
        expectedVersion: 1,
        decision: "APPROVED",
        safeReason: null,
        correlationId: prepareInput.correlationId,
        at,
      }),
    ).toBe("changed");
    expect(
      await repo.decide({
        actor,
        requestId: first.id,
        stepId: future!.id,
        expectedVersion: 1,
        decision: "APPROVED",
        safeReason: null,
        correlationId: prepareInput.correlationId,
        at,
      }),
    ).toBe("changed");
    expect((await repo.findById(organizationA, first.id))?.status).toBe(
      "APPROVED",
    );
  });

  it("serializes duplicate decisions and approve/reject races", async () => {
    const repo = repository();
    const policy: ValidatedApprovalPolicy = {
      ...sequentialPolicy,
      policyKey: "test.single",
      outcome: "SINGLE_APPROVER",
      steps: [sequentialPolicy.steps[0]!],
    };
    const request = await repo.prepare(
      { ...prepareInput, idempotencyMaterial: "decision-race" },
      policy,
    );
    const decision = {
      actor,
      requestId: request.id,
      stepId: request.steps[0]!.id,
      expectedVersion: 1,
      safeReason: null,
      correlationId: prepareInput.correlationId,
      at,
    };
    const results = await Promise.all([
      repo.decide({ ...decision, decision: "APPROVED" }),
      repo.decide({ ...decision, decision: "REJECTED" }),
    ]);
    expect(results.filter((result) => result === "changed")).toHaveLength(1);
    expect(
      await client.approvalHistoryEntry.count({
        where: {
          approvalRequestId: request.id,
          category: { in: ["STEP_APPROVED", "REQUEST_REJECTED"] },
        },
      }),
    ).toBe(1);
    expect(["APPROVED", "REJECTED"]).toContain(
      (await repo.findById(organizationA, request.id))?.status,
    );
  });

  it("claims exact approved execution once and keeps owning-command success atomic", async () => {
    const repo = repository();
    const policy: ValidatedApprovalPolicy = {
      ...sequentialPolicy,
      policyKey: "test.execution",
      outcome: "SINGLE_APPROVER",
      steps: [sequentialPolicy.steps[0]!],
    };
    const request = await repo.prepare(
      { ...prepareInput, idempotencyMaterial: "execution" },
      policy,
    );
    await repo.decide({
      actor,
      requestId: request.id,
      stepId: request.steps[0]!.id,
      expectedVersion: 1,
      decision: "APPROVED",
      safeReason: null,
      correlationId: prepareInput.correlationId,
      at,
    });
    const verification = {
      actor,
      approvalReference: request.id,
      action: prepareInput.action,
      resource: prepareInput.resource,
      risk: prepareInput.risk,
      policy,
      contextFingerprint: approvalFingerprint(prepareInput.safeContext),
      correlationId: prepareInput.correlationId,
      at,
    };
    const claim = await repo.claimExecution(verification);
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("Expected claim");
    expect(await repo.claimExecution(verification)).toEqual({
      status: "already_processing",
    });
    await runInTransaction(client, async (transaction) => {
      await transaction.organization.update({
        where: { id: organizationA },
        data: { displayName: "Executed exactly once" },
      });
      await repo.completeExecution(
        {
          claimVersion: claim.claimVersion,
          organizationId: organizationA,
          approvalReference: request.id,
          resultReference: "technical-result",
          correlationId: prepareInput.correlationId,
          at,
        },
        transaction,
      );
    });
    expect(await repo.claimExecution(verification)).toEqual({
      status: "already_succeeded",
      resultReference: "technical-result",
    });
    expect(
      (await client.organization.findUnique({ where: { id: organizationA } }))
        ?.displayName,
    ).toBe("Executed exactly once");
    expect(
      await client.auditEvent.count({
        where: { approvalReference: request.id },
      }),
    ).toBe(2);
    expect(
      await repo.claimExecution({
        ...verification,
        action: "admin.employee.deactivate",
      }),
    ).toEqual({ status: "denied" });
    expect(
      await repo.claimExecution({
        ...verification,
        actor: { ...actor, employeeId: employeeB },
      }),
    ).toEqual({ status: "denied" });
  });

  it("rolls back a failed owning mutation before recording safe execution failure", async () => {
    const repo = repository();
    const policy: ValidatedApprovalPolicy = {
      ...sequentialPolicy,
      policyKey: "test.failure",
      outcome: "SINGLE_APPROVER",
      steps: [sequentialPolicy.steps[0]!],
    };
    const input = { ...prepareInput, idempotencyMaterial: "execution-failure" };
    const request = await repo.prepare(input, policy);
    await repo.decide({
      actor,
      requestId: request.id,
      stepId: request.steps[0]!.id,
      expectedVersion: 1,
      decision: "APPROVED",
      safeReason: null,
      correlationId: input.correlationId,
      at,
    });
    const verification = {
      actor,
      approvalReference: request.id,
      action: input.action,
      resource: input.resource,
      risk: input.risk,
      policy,
      contextFingerprint: approvalFingerprint(input.safeContext),
      correlationId: input.correlationId,
      at,
    };
    const claim = await repo.claimExecution(verification);
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("Expected claim");
    const before = (await client.organization.findUnique({
      where: { id: organizationA },
    }))!.displayName;
    await expect(
      runInTransaction(client, async (transaction) => {
        await transaction.organization.update({
          where: { id: organizationA },
          data: { displayName: "Must roll back" },
        });
        throw new Error("technical mutation failed");
      }),
    ).rejects.toThrow("technical mutation failed");
    expect(
      (await client.organization.findUnique({ where: { id: organizationA } }))
        ?.displayName,
    ).toBe(before);
    await runInTransaction(client, (transaction) =>
      repo.failExecution(
        {
          claimVersion: claim.claimVersion,
          organizationId: organizationA,
          approvalReference: request.id,
          safeFailureCode: "OWNING_MUTATION_FAILED",
          correlationId: input.correlationId,
          at,
        },
        transaction,
      ),
    );
    expect((await repo.findById(organizationA, request.id))?.status).toBe(
      "FAILED",
    );
  });
});
