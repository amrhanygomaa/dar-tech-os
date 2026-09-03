import { Writable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ApiConfig } from "@dar-tech/config";
import { createPrismaClient, type DatabaseClient } from "@dar-tech/database";
import { RequestContextStore, StructuredLogger } from "@dar-tech/observability";
import { AppModule } from "../app.module.js";
import {
  AUDIT_EVENT_APPEND_PORT,
  SECURITY_EVENT_APPEND_PORT,
  type AuditEventAppendPort,
  type SecurityEventAppendPort,
} from "../event-history/event-history.contracts.js";
import { configureApiFoundation } from "../platform/configure-api-foundation.js";
import type { RoleActor } from "../roles/role.contracts.js";
import type {
  PermissionActor,
  RolePermissionView,
} from "./permission.contracts.js";
import { PERMISSION_REGISTRY } from "./permission-manifest.js";
import { PrismaPermissionRepository } from "./prisma-permission.repository.js";
import { PermissionRegistryService } from "./permission.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const organizationAId = "018f53d4-2f68-7c52-a399-3df2364da001";
const organizationBId = "018f53d4-2f68-7c52-a399-3df2364da002";
const actorAId = "018f53d4-2f68-7c52-a399-3df2364da011";
const actorBId = "018f53d4-2f68-7c52-a399-3df2364da012";
const employeeAId = "018f53d4-2f68-7c52-a399-3df2364da021";
const employeeBId = "018f53d4-2f68-7c52-a399-3df2364da022";
const actorAAccountId = "018f53d4-2f68-7c52-a399-3df2364da031";
const actorBAccountId = "018f53d4-2f68-7c52-a399-3df2364da032";

const actorA: PermissionActor & RoleActor = {
  actorType: "employee",
  organizationId: organizationAId,
  employeeId: actorAId,
  userAccountId: actorAAccountId,
};
const actorB: PermissionActor & RoleActor = {
  actorType: "employee",
  organizationId: organizationBId,
  employeeId: actorBId,
  userAccountId: actorBAccountId,
};

const config: ApiConfig = {
  runtime: "api",
  appEnvironment: "test",
  nodeEnvironment: "test",
  logLevel: "error",
  port: 3001,
  databaseUrl: databaseUrl ?? "postgresql://test:test@127.0.0.1:5432/test",
  databasePoolMax: 16,
  databaseConnectTimeoutMs: 2_000,
  databaseIdleTimeoutMs: 2_000,
  authentication: {
    allowedRedirectUris: ["http://localhost:3000/onboarding/callback/local"],
    localProviderEnabled: true,
    localIdentities: [],
    transactionTtlSeconds: 300,
  },
  invitation: {
    ttlSeconds: 300,
    rateLimitMaxRequests: 100,
    rateLimitWindowSeconds: 60,
  },
  session: { idleTtlSeconds: 300, absoluteTtlSeconds: 3600, allowedOrigins: ['http://localhost:3000'], secureCookie: false },
};

async function clearData(client: DatabaseClient): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_events", "security_events", "sessions", "role_permissions", "employee_roles", "permissions", "roles", "invitations", "sso_identities", "user_accounts", "employees", "organizations"',
  );
  await client.outboxConsumerReceipt.deleteMany();
  await client.outboxEvent.deleteMany();
  await client.queueJob.deleteMany();
}

async function seedIdentity(client: DatabaseClient): Promise<void> {
  await client.organization.createMany({
    data: [
      { id: organizationAId, displayName: "Organization A" },
      { id: organizationBId, displayName: "Organization B" },
    ],
  });
  await client.employee.createMany({
    data: [
      {
        id: actorAId,
        organizationId: organizationAId,
        employeeCode: "A-ACTOR",
        firstName: "A",
        lastName: "Actor",
        displayName: "A Actor",
        workEmail: "actor-a@example.com",
        lifecycleStatus: "ACTIVE",
        activatedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      {
        id: actorBId,
        organizationId: organizationBId,
        employeeCode: "B-ACTOR",
        firstName: "B",
        lastName: "Actor",
        displayName: "B Actor",
        workEmail: "actor-b@example.com",
        lifecycleStatus: "ACTIVE",
        activatedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      {
        id: employeeAId,
        organizationId: organizationAId,
        employeeCode: "A-EMPLOYEE",
        firstName: "Employee",
        lastName: "A",
        displayName: "Employee A",
        workEmail: "employee-a@example.com",
        lifecycleStatus: "ACTIVE",
        activatedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      {
        id: employeeBId,
        organizationId: organizationBId,
        employeeCode: "B-EMPLOYEE",
        firstName: "Employee",
        lastName: "B",
        displayName: "Employee B",
        workEmail: "employee-b@example.com",
        lifecycleStatus: "ACTIVE",
        activatedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
    ],
  });
  await client.userAccount.createMany({
    data: [
      {
        id: actorAAccountId,
        organizationId: organizationAId,
        employeeId: actorAId,
        authenticationEligible: true,
        activatedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      {
        id: actorBAccountId,
        organizationId: organizationBId,
        employeeId: actorBId,
        authenticationEligible: true,
        activatedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
    ],
  });
}

describe.skipIf(!databaseUrl)(
  "S02-T06 permission registry PostgreSQL integration",
  () => {
    let client: DatabaseClient;
    let app: INestApplication;
    let repository: PrismaPermissionRepository;
    let registry: PermissionRegistryService;
    let currentActor: PermissionActor | null = actorA;
    let allowed = true;
    let now = new Date("2026-09-03T12:00:00.000Z");

    beforeAll(async () => {
      client = createPrismaClient({ databaseUrl: databaseUrl as string });
      const contextStore = new RequestContextStore();
      const destination = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      const logger = new StructuredLogger(contextStore, {
        runtime: "api",
        environment: "test",
        level: "error",
        destination,
      });
      app = await NestFactory.create(
        AppModule.register(
          config,
          { contextStore, logger },
          {
            permissionTestAdapters: {
              actors: { currentActor: () => Promise.resolve(currentActor) },
              authorization: { allows: () => Promise.resolve(allowed) },
              clock: { now: () => now },
            },
            roleTestAdapters: {
              actors: {
                currentActor: () =>
                  Promise.resolve(currentActor as RoleActor | null),
              },
              authorization: { authorize: () => Promise.resolve(allowed) },
              clock: { now: () => now },
            },
          },
        ),
        { logger },
      );
      configureApiFoundation(app, contextStore, logger);
      await app.init();
      repository = app.get(PrismaPermissionRepository);
      registry = app.get(PermissionRegistryService);
    });

    beforeEach(async () => {
      vi.restoreAllMocks();
      await clearData(client);
      await seedIdentity(client);
      currentActor = actorA;
      allowed = true;
      now = new Date("2026-09-03T12:00:00.000Z");
      await registry.synchronize();
    });

    afterAll(async () => {
      if (client) await clearData(client);
      if (app) await app.close();
      if (client) await client.$disconnect();
    });

    async function createRole(
      key: string,
      organizationId = organizationAId,
      archivedAt: Date | null = null,
    ) {
      return client.role.create({
        data: {
          organizationId,
          key,
          name: key,
          normalizedName: key,
          archivedAt,
        },
      });
    }

    async function assignEmployeeRole(
      roleId: string,
      options: {
        employeeId?: string;
        effectiveAt?: Date;
        expiresAt?: Date | null;
        removedAt?: Date | null;
      } = {},
    ) {
      const effectiveAt = options.effectiveAt ?? now;
      return client.employeeRole.create({
        data: {
          organizationId: organizationAId,
          employeeId: options.employeeId ?? employeeAId,
          roleId,
          assignedByEmployeeId: actorAId,
          assignedAt: effectiveAt,
          effectiveAt,
          expiresAt: options.expiresAt ?? null,
          removedAt: options.removedAt ?? null,
          removedByEmployeeId: options.removedAt ? actorAId : null,
        },
      });
    }

    async function grant(
      roleId: string,
      permissionKey: string,
      scopeType = "ORGANIZATION",
      extra: Record<string, unknown> = {},
      expectedStatus = 201,
    ): Promise<RolePermissionView> {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/roles/${roleId}/permissions`)
        .send({ permissionKey, scopeType, ...extra })
        .expect(expectedStatus);
      return response.body.data as RolePermissionView;
    }

    it("synchronizes all 31 definitions transactionally and remains idempotent", async () => {
      const permissions = await client.permission.findMany({
        orderBy: { key: "asc" },
      });
      expect(permissions).toHaveLength(31);
      expect(
        permissions.filter(({ key }) => key === "admin.invitation.resend"),
      ).toHaveLength(1);
      expect(
        permissions.some(({ key }) =>
          /^(?:crm|sales|projects|finance|licensing)\./u.test(key),
        ),
      ).toBe(false);
      expect(
        await client.auditEvent.count({
          where: {
            actionKey: "system.permission.register",
            organizationId: null,
          },
        }),
      ).toBe(31);
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.permission-registered" },
        }),
      ).toBe(31);
      const second = await registry.synchronize();
      expect(second).toEqual({
        registered: 0,
        metadataUpdated: 0,
        unchanged: 31,
      });
      expect(await client.permission.count()).toBe(31);
      expect(
        await client.auditEvent.count({
          where: { actionKey: "system.permission.register" },
        }),
      ).toBe(31);
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.permission-registered" },
        }),
      ).toBe(31);
      expect(await registry.validate()).toMatchObject({
        valid: true,
        canonicalCount: 31,
        persistedCount: 31,
      });
    });

    it("serves only the synchronized canonical catalog with critical risk metadata", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/permissions?page=1&pageSize=100")
        .expect(200);
      expect(response.body.data.total).toBe(31);
      const byKey = Object.fromEntries(
        response.body.data.items.map(
          (permission: { key: string; riskClassification: string }) => [
            permission.key,
            permission.riskClassification,
          ],
        ),
      );
      expect(byKey["admin.permission.manage"]).toBe("CRITICAL");
      expect(byKey["admin.access.emergency"]).toBe("CRITICAL");
    });

    it("allows only safe description synchronization and never silently renames or deletes", async () => {
      const key = "admin.employee.read";
      await client.permission.update({
        where: { key },
        data: { description: "drifted description" },
      });
      expect((await registry.validate()).valid).toBe(false);
      const eventCount = await client.outboxEvent.count({
        where: { eventType: "identity.permission-registered" },
      });
      expect(await registry.synchronize()).toMatchObject({
        metadataUpdated: 1,
      });
      expect((await registry.validate()).valid).toBe(true);
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.permission-registered" },
        }),
      ).toBe(eventCount);

      const original = await client.permission.findUniqueOrThrow({
        where: { key },
      });
      await expect(
        client.permission.update({
          where: { id: original.id },
          data: { key: "admin.employee.renamed" },
        }),
      ).rejects.toThrow();
      expect(
        await client.permission.findUnique({ where: { key } }),
      ).not.toBeNull();

      await client.permission.create({
        data: {
          key: "future.permission.read",
          domain: "future",
          resource: "permission",
          action: "read",
          description: "Unknown row retained for explicit review.",
          riskClassification: "LOW",
          active: true,
          definitionVersion: 1,
        },
      });
      await registry.synchronize();
      expect(
        await client.permission.findUnique({
          where: { key: "future.permission.read" },
        }),
      ).not.toBeNull();
      expect((await registry.validate()).issues).toContainEqual({
        code: "ACTIVE_UNKNOWN_PERMISSION",
        permissionKey: "future.permission.read",
      });
    });

    it("detects missing, inconsistent, and incompatible registry definitions", async () => {
      await client.permission.delete({
        where: { key: "identity.account.read_self" },
      });
      expect((await registry.validate()).issues).toContainEqual({
        code: "REQUIRED_KEY_MISSING",
        permissionKey: "identity.account.read_self",
      });
      await client.permission.update({
        where: { key: "admin.permission.read" },
        data: { definitionVersion: 2, riskClassification: "HIGH" },
      });
      const issues = (await registry.validate()).issues;
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "INCOMPATIBLE_DEFINITION_VERSION",
            permissionKey: "admin.permission.read",
          }),
          expect.objectContaining({
            code: "METADATA_MISMATCH",
            permissionKey: "admin.permission.read",
          }),
        ]),
      );
      await expect(registry.synchronize()).rejects.toThrow(
        "Incompatible definition",
      );
    });

    it("grants known permissions, persists history, and emits one critical administration boundary", async () => {
      const role = await createRole("grant-role");
      const created = await grant(role.id, "admin.employee.read");
      expect(created).toMatchObject({
        roleId: role.id,
        scopeType: "ORGANIZATION",
        effective: true,
        permission: { key: "admin.employee.read" },
      });
      const history = await request(app.getHttpServer())
        .get(`/api/v1/roles/${role.id}/permissions?page=1&pageSize=100`)
        .expect(200);
      expect(history.body.data).toMatchObject({
        total: 1,
        items: [{ id: created.id }],
      });
      expect(
        await client.auditEvent.count({
          where: { actionKey: "admin.permission.manage", targetId: created.id },
        }),
      ).toBe(1);
      expect(
        await client.securityEvent.findFirstOrThrow({
          where: { eventType: "RolePermissionGranted.v1" },
        }),
      ).toMatchObject({
        risk: "CRITICAL",
        outcome: "GRANTED",
        organizationId: organizationAId,
      });
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.role-permission-granted" },
        }),
      ).toBe(1);
    });

    it("denies malformed, unknown, inactive, and deprecated permission grants", async () => {
      const role = await createRole("denial-role");
      const malformed = await request(app.getHttpServer())
        .post(`/api/v1/roles/${role.id}/permissions`)
        .send({ permissionKey: "admin.*.read", scopeType: "ORGANIZATION" })
        .expect(422);
      expect(malformed.body.error.code).toBe("PERMISSION_INPUT_INVALID");
      const unknown = await request(app.getHttpServer())
        .post(`/api/v1/roles/${role.id}/permissions`)
        .send({
          permissionKey: "admin.employee.delete",
          scopeType: "ORGANIZATION",
        })
        .expect(422);
      expect(unknown.body.error.code).toBe("PERMISSION_NOT_REGISTERED");

      await client.permission.update({
        where: { key: "admin.employee.read" },
        data: { active: false },
      });
      const inactive = await request(app.getHttpServer())
        .post(`/api/v1/roles/${role.id}/permissions`)
        .send({
          permissionKey: "admin.employee.read",
          scopeType: "ORGANIZATION",
        })
        .expect(409);
      expect(inactive.body.error.code).toBe("PERMISSION_UNAVAILABLE");
      await client.permission.update({
        where: { key: "admin.employee.update" },
        data: { active: false, deprecatedAt: now },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/roles/${role.id}/permissions`)
        .send({
          permissionKey: "admin.employee.update",
          scopeType: "ORGANIZATION",
        })
        .expect(409);
    });

    it("prevents arbitrary database permissions from becoming grants or effective descriptors", async () => {
      const role = await createRole("rogue-role");
      await assignEmployeeRole(role.id);
      const rogue = await client.permission.create({
        data: {
          key: "rogue.permission.read",
          domain: "rogue",
          resource: "permission",
          action: "read",
          description: "Not canonical.",
          riskClassification: "LOW",
          active: true,
          definitionVersion: 1,
        },
      });
      await client.rolePermission.create({
        data: {
          organizationId: organizationAId,
          roleId: role.id,
          permissionId: rogue.id,
          scopeType: "ORGANIZATION",
          grantedByEmployeeId: actorAId,
          effectiveAt: now,
        },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/roles/${role.id}/permissions`)
        .send({ permissionKey: rogue.key, scopeType: "ORGANIZATION" })
        .expect(422);
      expect(
        await repository.listEffectivePermissionGrantsForEmployee(
          organizationAId,
          employeeAId,
          now,
        ),
      ).toEqual([]);
      expect((await registry.validate()).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "ACTIVE_UNKNOWN_PERMISSION",
            permissionKey: rogue.key,
          }),
          expect.objectContaining({
            code: "INVALID_GRANT_REFERENCE",
            permissionKey: rogue.key,
          }),
        ]),
      );
    });

    it("denies grants to archived roles and isolates history, grants, and removal by organization", async () => {
      const archived = await createRole("archived-role", organizationAId, now);
      const archivedResponse = await request(app.getHttpServer())
        .post(`/api/v1/roles/${archived.id}/permissions`)
        .send({
          permissionKey: "admin.employee.read",
          scopeType: "ORGANIZATION",
        })
        .expect(409);
      expect(archivedResponse.body.error.code).toBe("ROLE_ARCHIVED");

      const roleA = await createRole("org-a-role");
      const grantA = await grant(roleA.id, "admin.employee.read");
      const roleB = await createRole("org-b-role", organizationBId);
      currentActor = actorB;
      await request(app.getHttpServer())
        .get(`/api/v1/roles/${roleA.id}/permissions`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/roles/${roleA.id}/permissions`)
        .send({
          permissionKey: "admin.employee.update",
          scopeType: "ORGANIZATION",
        })
        .expect(404);
      await request(app.getHttpServer())
        .post(
          `/api/v1/roles/${roleA.id}/permissions/admin.employee.read/remove`,
        )
        .expect(404);
      currentActor = actorA;
      await request(app.getHttpServer())
        .post(`/api/v1/roles/${roleB.id}/permissions`)
        .send({
          permissionKey: "admin.employee.read",
          scopeType: "ORGANIZATION",
        })
        .expect(404);
      expect(
        (
          await client.rolePermission.findUniqueOrThrow({
            where: { id: grantA.id },
          })
        ).removedAt,
      ).toBeNull();
    });

    it("makes exact duplicates idempotent and different scope, binding, or expiry a stable conflict", async () => {
      const role = await createRole("idempotent-role");
      const first = await grant(role.id, "admin.employee.read", "PROJECT", {
        scopeBindingType: "project",
        scopeBindingId: "project:1",
      });
      const auditCount = await client.auditEvent.count();
      const securityCount = await client.securityEvent.count();
      const outboxCount = await client.outboxEvent.count();
      const second = await grant(role.id, "admin.employee.read", "PROJECT", {
        scopeBindingType: "project",
        scopeBindingId: "project:1",
      });
      expect(second.id).toBe(first.id);
      expect(await client.rolePermission.count()).toBe(1);
      expect(await client.auditEvent.count()).toBe(auditCount);
      expect(await client.securityEvent.count()).toBe(securityCount);
      expect(await client.outboxEvent.count()).toBe(outboxCount);
      const conflict = await request(app.getHttpServer())
        .post(`/api/v1/roles/${role.id}/permissions`)
        .send({ permissionKey: "admin.employee.read", scopeType: "SELF" })
        .expect(409);
      expect(conflict.body.error.code).toBe("ROLE_PERMISSION_CONFLICT");
    });

    it("uses exact expiry, preserves expired/removed history, and permits later regrant", async () => {
      const role = await createRole("history-role");
      await assignEmployeeRole(role.id);
      const expiresAt = new Date(now.getTime() + 60_000);
      const first = await grant(
        role.id,
        "admin.employee.read",
        "ORGANIZATION",
        {
          expiresAt: expiresAt.toISOString(),
        },
      );
      expect(
        await repository.listEffectivePermissionGrantsForEmployee(
          organizationAId,
          employeeAId,
          new Date(expiresAt.getTime() - 1),
        ),
      ).toHaveLength(1);
      expect(
        await repository.listEffectivePermissionGrantsForEmployee(
          organizationAId,
          employeeAId,
          expiresAt,
        ),
      ).toHaveLength(0);
      now = expiresAt;
      const second = await grant(role.id, "admin.employee.read");
      expect(second.id).not.toBe(first.id);
      expect(await client.rolePermission.count()).toBe(2);
      expect(
        (
          await client.rolePermission.findUniqueOrThrow({
            where: { id: first.id },
          })
        ).removedAt,
      ).toBeNull();

      const removed = await request(app.getHttpServer())
        .post(`/api/v1/roles/${role.id}/permissions/admin.employee.read/remove`)
        .expect(200);
      expect(removed.body.data).toMatchObject({
        id: second.id,
        effective: false,
      });
      const historyCount = await client.rolePermission.count();
      const eventCount = await client.outboxEvent.count({
        where: { eventType: "identity.role-permission-removed" },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/roles/${role.id}/permissions/admin.employee.read/remove`)
        .expect(200);
      expect(await client.rolePermission.count()).toBe(historyCount);
      expect(
        await client.outboxEvent.count({
          where: { eventType: "identity.role-permission-removed" },
        }),
      ).toBe(eventCount);
      const third = await grant(role.id, "admin.employee.read");
      expect(third.id).not.toBe(second.id);
      expect(await client.rolePermission.count()).toBe(3);
    });

    it("accepts all eight scope contracts while keeping PROJECT and CUSTOMER opaque", async () => {
      const role = await createRole("scope-role");
      const permissionKeys = PERMISSION_REGISTRY.slice(0, 8).map(
        ({ key }) => key,
      );
      for (const [index, scopeType] of [
        "SELF",
        "ASSIGNED",
        "TEAM",
        "DEPARTMENT",
        "PROJECT",
        "CUSTOMER",
        "ORGANIZATION",
        "EXPLICIT",
      ].entries()) {
        const requiresBinding = ["PROJECT", "CUSTOMER", "EXPLICIT"].includes(
          scopeType,
        );
        await grant(role.id, permissionKeys[index]!, scopeType, {
          ...(requiresBinding
            ? {
                scopeBindingType: scopeType.toLowerCase(),
                scopeBindingId: `opaque:${index}`,
              }
            : {}),
        });
      }
      const history = await request(app.getHttpServer())
        .get(`/api/v1/roles/${role.id}/permissions?pageSize=100`)
        .expect(200);
      expect(
        new Set(
          history.body.data.items.map(
            ({ scopeType }: { scopeType: string }) => scopeType,
          ),
        ),
      ).toEqual(
        new Set([
          "SELF",
          "ASSIGNED",
          "TEAM",
          "DEPARTMENT",
          "PROJECT",
          "CUSTOMER",
          "ORGANIZATION",
          "EXPLICIT",
        ]),
      );
      const tables = await client.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
      expect(tables.map(({ table_name }) => table_name)).not.toEqual(
        expect.arrayContaining([
          "projects",
          "customers",
          "teams",
          "departments",
        ]),
      );
    });

    it("unions all effective role grants and preserves distinct scopes for the same permission", async () => {
      const roleA = await createRole("multi-a");
      const roleB = await createRole("multi-b");
      const roleExpired = await createRole("multi-expired");
      const roleRemoved = await createRole("multi-removed");
      const roleArchived = await createRole("multi-archived");
      await assignEmployeeRole(roleA.id);
      await assignEmployeeRole(roleB.id);
      await assignEmployeeRole(roleExpired.id, {
        effectiveAt: new Date(now.getTime() - 60_000),
        expiresAt: now,
      });
      await assignEmployeeRole(roleRemoved.id, { removedAt: now });
      await assignEmployeeRole(roleArchived.id);
      await grant(roleA.id, "admin.employee.read", "ORGANIZATION");
      await grant(roleA.id, "audit.event.read", "ORGANIZATION");
      await grant(roleB.id, "admin.employee.read", "SELF");
      await grant(roleB.id, "security.event.read", "ORGANIZATION");
      await grant(roleExpired.id, "admin.role.read");
      await grant(roleRemoved.id, "admin.permission.read");
      await grant(roleArchived.id, "admin.invitation.read");
      await request(app.getHttpServer())
        .post(`/api/v1/roles/${roleArchived.id}/archive`)
        .expect(200);

      const effective =
        await repository.listEffectivePermissionGrantsForEmployee(
          organizationAId,
          employeeAId,
          now,
        );
      expect(
        effective.map(({ permissionKey }) => permissionKey).sort(),
      ).toEqual([
        "admin.employee.read",
        "admin.employee.read",
        "audit.event.read",
        "security.event.read",
      ]);
      expect(
        effective
          .filter(
            ({ permissionKey }) => permissionKey === "admin.employee.read",
          )
          .map(({ scopeType }) => scopeType)
          .sort(),
      ).toEqual(["ORGANIZATION", "SELF"]);
    });

    it("makes inactive or deprecated permissions and archived roles immediately ineffective", async () => {
      const role = await createRole("state-role");
      await assignEmployeeRole(role.id);
      await grant(role.id, "admin.employee.read");
      expect(
        await repository.listEffectivePermissionGrantsForEmployee(
          organizationAId,
          employeeAId,
          now,
        ),
      ).toHaveLength(1);
      await client.permission.update({
        where: { key: "admin.employee.read" },
        data: { active: false },
      });
      expect(
        await repository.listEffectivePermissionGrantsForEmployee(
          organizationAId,
          employeeAId,
          now,
        ),
      ).toHaveLength(0);
      await client.permission.update({
        where: { key: "admin.employee.read" },
        data: { deprecatedAt: now },
      });
      expect((await registry.validate()).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "INVALID_GRANT_REFERENCE" }),
        ]),
      );
      expect(await client.rolePermission.count()).toBe(1);
    });

    it("serializes concurrent duplicate and conflicting grants without blocking different permissions", async () => {
      const duplicateRole = await createRole("concurrent-duplicate");
      const duplicate = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/roles/${duplicateRole.id}/permissions`)
          .send({
            permissionKey: "admin.employee.read",
            scopeType: "ORGANIZATION",
          }),
        request(app.getHttpServer())
          .post(`/api/v1/roles/${duplicateRole.id}/permissions`)
          .send({
            permissionKey: "admin.employee.read",
            scopeType: "ORGANIZATION",
          }),
      ]);
      expect(duplicate.map(({ status }) => status)).toEqual([201, 201]);
      expect(new Set(duplicate.map(({ body }) => body.data.id)).size).toBe(1);
      expect(
        await client.rolePermission.count({
          where: { roleId: duplicateRole.id },
        }),
      ).toBe(1);

      const differentRole = await createRole("concurrent-different");
      const different = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/roles/${differentRole.id}/permissions`)
          .send({
            permissionKey: "admin.employee.read",
            scopeType: "ORGANIZATION",
          }),
        request(app.getHttpServer())
          .post(`/api/v1/roles/${differentRole.id}/permissions`)
          .send({
            permissionKey: "admin.employee.update",
            scopeType: "ORGANIZATION",
          }),
      ]);
      expect(different.map(({ status }) => status).sort()).toEqual([201, 201]);
      expect(
        await client.rolePermission.count({
          where: { roleId: differentRole.id },
        }),
      ).toBe(2);

      const conflictRole = await createRole("concurrent-conflict");
      const conflicting = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/roles/${conflictRole.id}/permissions`)
          .send({
            permissionKey: "admin.employee.read",
            scopeType: "ORGANIZATION",
          }),
        request(app.getHttpServer())
          .post(`/api/v1/roles/${conflictRole.id}/permissions`)
          .send({ permissionKey: "admin.employee.read", scopeType: "SELF" }),
      ]);
      expect(conflicting.map(({ status }) => status).sort()).toEqual([
        201, 409,
      ]);
      expect(
        await client.rolePermission.count({
          where: { roleId: conflictRole.id },
        }),
      ).toBe(1);
    });

    it("has safe serialized outcomes for grant/remove and grant/archive races", async () => {
      const removeRole = await createRole("remove-race");
      await grant(removeRole.id, "admin.employee.read");
      const grantRemove = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/roles/${removeRole.id}/permissions`)
          .send({
            permissionKey: "admin.employee.read",
            scopeType: "ORGANIZATION",
          }),
        request(app.getHttpServer()).post(
          `/api/v1/roles/${removeRole.id}/permissions/admin.employee.read/remove`,
        ),
      ]);
      expect(grantRemove.map(({ status }) => status).sort()).toEqual([
        200, 201,
      ]);
      const active = await client.rolePermission.count({
        where: {
          roleId: removeRole.id,
          removedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      expect(active).toBeLessThanOrEqual(1);

      const archiveRole = await createRole("archive-race");
      const grantArchive = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/roles/${archiveRole.id}/permissions`)
          .send({
            permissionKey: "admin.employee.read",
            scopeType: "ORGANIZATION",
          }),
        request(app.getHttpServer()).post(
          `/api/v1/roles/${archiveRole.id}/archive`,
        ),
      ]);
      expect(
        grantArchive.every(({ status }) => [200, 201, 409].includes(status)),
      ).toBe(true);
      expect(
        (await client.role.findUniqueOrThrow({ where: { id: archiveRole.id } }))
          .archivedAt,
      ).not.toBeNull();
      expect(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/roles/${archiveRole.id}/permissions`)
            .expect(200)
        ).body.data.items.every(
          ({ effective }: { effective: boolean }) => !effective,
        ),
      ).toBe(true);
    });

    it("rolls registry registration back on mandatory audit or outbox failure", async () => {
      await client.$executeRawUnsafe(
        'TRUNCATE TABLE "audit_events", "security_events", "role_permissions", "permissions"',
      );
      await client.outboxEvent.deleteMany();
      const audit = app.get<AuditEventAppendPort>(AUDIT_EVENT_APPEND_PORT);
      vi.spyOn(audit, "append").mockRejectedValueOnce(
        new Error("forced registry audit failure"),
      );
      await expect(registry.synchronize()).rejects.toThrow(
        "forced registry audit failure",
      );
      expect(await client.permission.count()).toBe(0);
      expect(await client.auditEvent.count()).toBe(0);
      expect(await client.outboxEvent.count()).toBe(0);
      vi.restoreAllMocks();

      await client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_t06_registry_outbox() RETURNS trigger AS $$
      BEGIN
        IF NEW.event_type = 'identity.permission-registered' THEN
          RAISE EXCEPTION 'forced registry outbox failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_t06_registry_outbox BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION reject_t06_registry_outbox();
    `);
      try {
        await expect(registry.synchronize()).rejects.toThrow();
        expect(await client.permission.count()).toBe(0);
        expect(await client.auditEvent.count()).toBe(0);
        expect(await client.outboxEvent.count()).toBe(0);
      } finally {
        await client.$executeRawUnsafe(
          "DROP TRIGGER IF EXISTS reject_t06_registry_outbox ON outbox_events",
        );
        await client.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS reject_t06_registry_outbox()",
        );
      }
    });

    it("rolls grants and removals back on persistence, audit, security, or outbox failure", async () => {
      const role = await createRole("rollback-role");
      const baseline = async () => ({
        grants: await client.rolePermission.count(),
        audits: await client.auditEvent.count(),
        security: await client.securityEvent.count(),
        outbox: await client.outboxEvent.count(),
      });

      await client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_t06_grant_persistence() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced role permission persistence failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_t06_grant_persistence BEFORE INSERT ON role_permissions
      FOR EACH ROW EXECUTE FUNCTION reject_t06_grant_persistence();
    `);
      const beforePersistence = await baseline();
      try {
        await grant(role.id, "admin.employee.read", "ORGANIZATION", {}, 500);
        expect(await baseline()).toEqual(beforePersistence);
      } finally {
        await client.$executeRawUnsafe(
          "DROP TRIGGER IF EXISTS reject_t06_grant_persistence ON role_permissions",
        );
        await client.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS reject_t06_grant_persistence()",
        );
      }

      const audit = app.get<AuditEventAppendPort>(AUDIT_EVENT_APPEND_PORT);
      const beforeAudit = await baseline();
      vi.spyOn(audit, "append").mockRejectedValueOnce(
        new Error("forced grant audit failure"),
      );
      await grant(role.id, "admin.employee.read", "ORGANIZATION", {}, 500);
      expect(await baseline()).toEqual(beforeAudit);
      vi.restoreAllMocks();

      const security = app.get<SecurityEventAppendPort>(
        SECURITY_EVENT_APPEND_PORT,
      );
      const beforeSecurity = await baseline();
      vi.spyOn(security, "append").mockRejectedValueOnce(
        new Error("forced security failure"),
      );
      await grant(role.id, "admin.employee.read", "ORGANIZATION", {}, 500);
      expect(await baseline()).toEqual(beforeSecurity);
      vi.restoreAllMocks();

      await client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_t06_role_permission_outbox() RETURNS trigger AS $$
      BEGIN
        IF NEW.event_type LIKE 'identity.role-permission-%' THEN
          RAISE EXCEPTION 'forced role permission outbox failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_t06_role_permission_outbox BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION reject_t06_role_permission_outbox();
    `);
      const beforeOutbox = await baseline();
      try {
        await grant(role.id, "admin.employee.read", "ORGANIZATION", {}, 500);
        expect(await baseline()).toEqual(beforeOutbox);
      } finally {
        await client.$executeRawUnsafe(
          "DROP TRIGGER IF EXISTS reject_t06_role_permission_outbox ON outbox_events",
        );
        await client.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS reject_t06_role_permission_outbox()",
        );
      }

      const created = await grant(role.id, "admin.employee.read");
      const beforeRemoval = await baseline();
      vi.spyOn(audit, "append").mockRejectedValueOnce(
        new Error("forced removal audit failure"),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/roles/${role.id}/permissions/admin.employee.read/remove`)
        .expect(500);
      expect(await baseline()).toEqual(beforeRemoval);
      expect(
        (
          await client.rolePermission.findUniqueOrThrow({
            where: { id: created.id },
          })
        ).removedAt,
      ).toBeNull();
    });

    it("uses only restrictive relations and introduces no unauthorized entity tables", async () => {
      const foreignKeys = await client.$queryRaw<
        Array<{ delete_rule: string }>
      >`
      SELECT rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('permissions', 'role_permissions')
        AND tc.constraint_type = 'FOREIGN KEY'
    `;
      expect(foreignKeys).toHaveLength(6);
      expect(
        foreignKeys.every(({ delete_rule }) => delete_rule === "RESTRICT"),
      ).toBe(true);
      const tables = await client.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
      const names = tables.map(({ table_name }) => table_name);
      expect(names).toEqual(
        expect.arrayContaining(["permissions", "role_permissions"]),
      );
      expect(names).not.toEqual(
        expect.arrayContaining([
          "sessions",
          "approval_requests",
          "temporary_access_grants",
          "emergency_access_grants",
          "projects",
          "customers",
        ]),
      );
    });
  },
);
