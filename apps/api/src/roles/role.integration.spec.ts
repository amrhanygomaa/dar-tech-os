import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { createPrismaClient, type DatabaseClient } from '@dar-tech/database';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from '../app.module.js';
import {
  AUDIT_EVENT_APPEND_PORT,
  type AuditEventAppendPort,
} from '../event-history/event-history.contracts.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import type { EmployeeRoleView, RoleActor, RoleView } from './role.contracts.js';
import { PrismaRoleRepository } from './prisma-role.repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const organizationAId = '018f53d4-2f68-7c52-a399-3df2364d9901';
const organizationBId = '018f53d4-2f68-7c52-a399-3df2364d9902';
const actorAId = '018f53d4-2f68-7c52-a399-3df2364d9911';
const actorBId = '018f53d4-2f68-7c52-a399-3df2364d9912';
const employeeAId = '018f53d4-2f68-7c52-a399-3df2364d9921';
const employeeA2Id = '018f53d4-2f68-7c52-a399-3df2364d9922';
const employeeBId = '018f53d4-2f68-7c52-a399-3df2364d9923';
const actorAAccountId = '018f53d4-2f68-7c52-a399-3df2364d9931';
const actorBAccountId = '018f53d4-2f68-7c52-a399-3df2364d9932';

const actorA: RoleActor = {
  actorType: 'employee',
  organizationId: organizationAId,
  employeeId: actorAId,
  userAccountId: actorAAccountId,
};
const actorB: RoleActor = {
  actorType: 'employee',
  organizationId: organizationBId,
  employeeId: actorBId,
  userAccountId: actorBAccountId,
};

const config: ApiConfig = {
  runtime: 'api',
  appEnvironment: 'test',
  nodeEnvironment: 'test',
  logLevel: 'info',
  port: 3001,
  databaseUrl: databaseUrl ?? 'postgresql://test:test@127.0.0.1:5432/test',
  databasePoolMax: 12,
  databaseConnectTimeoutMs: 2_000,
  databaseIdleTimeoutMs: 2_000,
  authentication: {
    allowedRedirectUris: ['http://localhost:3000/onboarding/callback/local'],
    localProviderEnabled: true,
    localIdentities: [],
    transactionTtlSeconds: 300,
  },
  invitation: { ttlSeconds: 300, rateLimitMaxRequests: 100, rateLimitWindowSeconds: 60 },
};

async function clearData(client: DatabaseClient): Promise<void> {
  await client.$executeRawUnsafe('TRUNCATE TABLE "audit_events", "security_events"');
  await client.outboxConsumerReceipt.deleteMany();
  await client.outboxEvent.deleteMany();
  await client.queueJob.deleteMany();
  await client.employeeRole.deleteMany();
  await client.role.deleteMany();
  await client.invitation.deleteMany();
  await client.sSOIdentity.deleteMany();
  await client.userAccount.deleteMany();
  await client.employee.deleteMany();
  await client.organization.deleteMany();
}

async function seedIdentity(client: DatabaseClient): Promise<void> {
  await client.organization.createMany({
    data: [
      { id: organizationAId, displayName: 'Organization A' },
      { id: organizationBId, displayName: 'Organization B' },
    ],
  });
  await client.employee.createMany({
    data: [
      {
        id: actorAId,
        organizationId: organizationAId,
        employeeCode: 'A-ACTOR',
        firstName: 'A',
        lastName: 'Actor',
        displayName: 'A Actor',
        workEmail: 'actor-a@example.com',
        lifecycleStatus: 'ACTIVE',
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        id: actorBId,
        organizationId: organizationBId,
        employeeCode: 'B-ACTOR',
        firstName: 'B',
        lastName: 'Actor',
        displayName: 'B Actor',
        workEmail: 'actor-b@example.com',
        lifecycleStatus: 'ACTIVE',
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        id: employeeAId,
        organizationId: organizationAId,
        employeeCode: 'A-ONE',
        firstName: 'Employee',
        lastName: 'One',
        displayName: 'Employee One',
        workEmail: 'employee-one@example.com',
        lifecycleStatus: 'ACTIVE',
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        id: employeeA2Id,
        organizationId: organizationAId,
        employeeCode: 'A-TWO',
        firstName: 'Employee',
        lastName: 'Two',
        displayName: 'Employee Two',
        workEmail: 'employee-two@example.com',
        lifecycleStatus: 'ACTIVE',
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        id: employeeBId,
        organizationId: organizationBId,
        employeeCode: 'B-ONE',
        firstName: 'Employee',
        lastName: 'B One',
        displayName: 'Employee B One',
        workEmail: 'employee-b-one@example.com',
        lifecycleStatus: 'ACTIVE',
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
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
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        id: actorBAccountId,
        organizationId: organizationBId,
        employeeId: actorBId,
        authenticationEligible: true,
        activatedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    ],
  });
}

describe.skipIf(!databaseUrl)('S02-T05 role model PostgreSQL integration', () => {
  let client: DatabaseClient;
  let app: INestApplication;
  let repository: PrismaRoleRepository;
  let currentActor: RoleActor | null = actorA;
  let allowed = true;
  let now = new Date('2026-09-02T12:00:00.000Z');
  let logOutput = '';

  beforeAll(async () => {
    client = createPrismaClient({ databaseUrl: databaseUrl as string });
    const contextStore = new RequestContextStore();
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logOutput += chunk.toString();
        callback();
      },
    });
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'test',
      level: 'info',
      destination,
    });
    app = await NestFactory.create(
      AppModule.register(
        config,
        { contextStore, logger },
        {
          roleTestAdapters: {
            actors: { currentActor: () => Promise.resolve(currentActor) },
            authorization: { authorize: () => Promise.resolve(allowed) },
            clock: { now: () => now },
          },
        },
      ),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger);
    await app.init();
    repository = app.get(PrismaRoleRepository);
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearData(client);
    await seedIdentity(client);
    currentActor = actorA;
    allowed = true;
    now = new Date('2026-09-02T12:00:00.000Z');
    logOutput = '';
  });

  afterAll(async () => {
    if (client) await clearData(client);
    if (app) await app.close();
    if (client) await client.$disconnect();
  });

  async function createRole(key: string, name: string, description?: string): Promise<RoleView> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .send({ key, name, ...(description ? { description } : {}) })
      .expect(201);
    return response.body.data as RoleView;
  }

  async function assign(
    employeeId: string,
    roleId: string,
    expiresAt?: Date,
    expectedStatus = 201,
  ): Promise<EmployeeRoleView> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeId}/roles`)
      .send({ roleId, ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}) })
      .expect(expectedStatus);
    return response.body.data as EmployeeRoleView;
  }

  it('creates normalized organization roles and allows the same key in another organization', async () => {
    const roleA = await createRole('  Project-Manager ', '  Project   Manager  ', '  Delivery lead  ');
    expect(roleA).toMatchObject({
      key: 'project-manager',
      name: 'Project Manager',
      normalizedName: 'project manager',
      description: 'Delivery lead',
      archived: false,
    });

    currentActor = actorB;
    const roleB = await createRole('PROJECT-MANAGER', 'Project Manager');
    expect(roleB.key).toBe(roleA.key);
    expect(roleB.organizationId).toBe(organizationBId);
  });

  it('denies duplicate key and duplicate normalized name within one organization', async () => {
    await createRole('operations', 'Operations');
    const duplicateKey = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .send({ key: 'OPERATIONS', name: 'Different' })
      .expect(409);
    expect(duplicateKey.body.error.code).toBe('ROLE_CONFLICT');
    const duplicateName = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .send({ key: 'another', name: '  OPERATIONS ' })
      .expect(409);
    expect(duplicateName.body.error.code).toBe('ROLE_CONFLICT');
  });

  it('updates allowlisted fields, keeps the stable key immutable, and archives explicitly', async () => {
    const role = await createRole('finance-reviewer', 'Finance Reviewer');
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/roles/${role.id}`)
      .send({ name: 'Financial Reviewer', description: 'Review only' })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      key: 'finance-reviewer',
      name: 'Financial Reviewer',
      description: 'Review only',
    });
    const immutable = await request(app.getHttpServer())
      .patch(`/api/v1/roles/${role.id}`)
      .send({ key: 'renamed' })
      .expect(422);
    expect(immutable.body.error.code).toBe('ROLE_KEY_IMMUTABLE');
    const archived = await request(app.getHttpServer())
      .post(`/api/v1/roles/${role.id}/archive`)
      .expect(200);
    expect(archived.body.data.archived).toBe(true);
    const repeated = await request(app.getHttpServer())
      .post(`/api/v1/roles/${role.id}/archive`)
      .expect(200);
    expect(repeated.body.data.id).toBe(role.id);
    expect(await client.role.count({ where: { id: role.id } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.role-archived' } })).toBe(1);
  });

  it('uses fail-closed trusted actor and authorization ports with no role-name bypass', async () => {
    await createRole('founder', 'Founder');
    await createRole('super-admin', 'Super Admin');
    await createRole('developer', 'Developer');
    currentActor = null;
    await request(app.getHttpServer()).get('/api/v1/roles').expect(401);
    currentActor = actorA;
    allowed = false;
    await request(app.getHttpServer())
      .get('/api/v1/roles?role=Founder&jobTitle=Founder')
      .set('X-Role', 'Super Admin')
      .expect(403);
    expect(logOutput).toContain('authorization_denied');
  });

  it('uses the approved additive schema without permission persistence or destructive relations', async () => {
    const tables = await client.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    const tableNames = tables.map(({ table_name }) => table_name);
    expect(tableNames).toContain('roles');
    expect(tableNames).toContain('employee_roles');
    expect(tableNames).not.toContain('permissions');
    expect(tableNames).not.toContain('role_permissions');

    const employeeRoleIdColumn = await client.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'role_id'
    `;
    expect(Number(employeeRoleIdColumn[0]?.count ?? 0n)).toBe(0);

    const foreignKeys = await client.$queryRaw<Array<{ delete_rule: string }>>`
      SELECT rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_schema = tc.constraint_schema
        AND rc.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('roles', 'employee_roles')
        AND tc.constraint_type = 'FOREIGN KEY'
    `;
    expect(foreignKeys).toHaveLength(6);
    expect(foreignKeys.every(({ delete_rule }) => delete_rule === 'RESTRICT')).toBe(true);
  });

  it('lets an employee hold multiple effective roles and one role belong to multiple employees', async () => {
    const operations = await createRole('operations', 'Operations');
    const manager = await createRole('project-manager', 'Project Manager');
    const security = await createRole('security-reviewer', 'Security Reviewer');
    await assign(employeeAId, operations.id);
    await assign(employeeAId, manager.id);
    await assign(employeeAId, security.id);
    await assign(employeeA2Id, operations.id);
    const employeeOne = await repository.listEffectiveRolesForEmployee(
      organizationAId,
      employeeAId,
      now,
    );
    expect(employeeOne.map(({ role }) => role.key).sort()).toEqual([
      'operations',
      'project-manager',
      'security-reviewer',
    ]);
    expect(await client.employeeRole.count({ where: { employeeId: employeeAId } })).toBe(3);
    expect(await client.employeeRole.count({ where: { roleId: operations.id } })).toBe(2);
  });

  it('returns the same effective assignment idempotently without duplicate audit or outbox', async () => {
    const role = await createRole('quality', 'Quality');
    const first = await assign(employeeAId, role.id);
    const beforeAudit = await client.auditEvent.count();
    const beforeOutbox = await client.outboxEvent.count();
    const second = await assign(employeeAId, role.id);
    expect(second.id).toBe(first.id);
    expect(await client.employeeRole.count()).toBe(1);
    expect(await client.auditEvent.count()).toBe(beforeAudit);
    expect(await client.outboxEvent.count()).toBe(beforeOutbox);

    const conflict = await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeAId}/roles`)
      .send({ roleId: role.id, expiresAt: new Date(now.getTime() + 60_000).toISOString() })
      .expect(409);
    expect(conflict.body.error.code).toBe('EMPLOYEE_ROLE_ASSIGNMENT_CONFLICT');
  });

  it('uses direct exact-boundary expiry checks, preserves history, and permits reassignment', async () => {
    const role = await createRole('time-bounded', 'Time Bounded');
    const expiresAt = new Date(now.getTime() + 60_000);
    const first = await assign(employeeAId, role.id, expiresAt);
    expect(
      await repository.listEffectiveRolesForEmployee(
        organizationAId,
        employeeAId,
        new Date(expiresAt.getTime() - 1),
      ),
    ).toHaveLength(1);
    expect(
      await repository.listEffectiveRolesForEmployee(organizationAId, employeeAId, expiresAt),
    ).toHaveLength(0);
    now = expiresAt;
    const second = await assign(employeeAId, role.id);
    expect(second.id).not.toBe(first.id);
    expect(await client.employeeRole.count({ where: { employeeId: employeeAId, roleId: role.id } })).toBe(2);
    expect((await client.employeeRole.findUniqueOrThrow({ where: { id: first.id } })).removedAt).toBeNull();
  });

  it('removes assignments historically and makes repeated removal idempotent', async () => {
    const role = await createRole('support', 'Support');
    const assignment = await assign(employeeAId, role.id);
    const removed = await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeAId}/roles/${role.id}/remove`)
      .expect(200);
    expect(removed.body.data).toMatchObject({ id: assignment.id, effective: false });
    expect(removed.body.data.removedAt).not.toBeNull();
    const auditCount = await client.auditEvent.count();
    const outboxCount = await client.outboxEvent.count();
    await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeAId}/roles/${role.id}/remove`)
      .expect(200);
    expect(await client.employeeRole.count()).toBe(1);
    expect(await client.auditEvent.count()).toBe(auditCount);
    expect(await client.outboxEvent.count()).toBe(outboxCount);
  });

  it('keeps assignment rows but makes them ineffective when a role is archived', async () => {
    const role = await createRole('archivable', 'Archivable');
    const assignment = await assign(employeeAId, role.id);
    await request(app.getHttpServer()).post(`/api/v1/roles/${role.id}/archive`).expect(200);
    expect(await repository.listEffectiveRolesForEmployee(organizationAId, employeeAId, now)).toHaveLength(0);
    expect(await client.employeeRole.count({ where: { id: assignment.id } })).toBe(1);
    const denied = await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeA2Id}/roles`)
      .send({ roleId: role.id })
      .expect(409);
    expect(denied.body.error.code).toBe('ROLE_ARCHIVED');
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-role-removed' } })).toBe(0);
  });

  it('isolates role reads, mutations, assignment pairs, and removals by organization', async () => {
    const roleA = await createRole('org-a-only', 'Org A Only');
    await assign(employeeAId, roleA.id);
    currentActor = actorB;
    const listB = await request(app.getHttpServer()).get('/api/v1/roles').expect(200);
    expect(listB.body.data.items).toEqual([]);
    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${roleA.id}`)
      .send({ name: 'Leaked' })
      .expect(404);
    await request(app.getHttpServer()).post(`/api/v1/roles/${roleA.id}/archive`).expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeBId}/roles`)
      .send({ roleId: roleA.id })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeBId}/roles/${roleA.id}/remove`)
      .expect(404);

    const roleB = await createRole('org-b-only', 'Org B Only');
    currentActor = actorA;
    await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeAId}/roles`)
      .send({ roleId: roleB.id })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeBId}/roles`)
      .send({ roleId: roleA.id })
      .expect(404);
  });

  it('serializes concurrent duplicate assignment to one new effective row', async () => {
    const role = await createRole('concurrent', 'Concurrent');
    const responses = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/employees/${employeeAId}/roles`).send({ roleId: role.id }),
      request(app.getHttpServer()).post(`/api/v1/employees/${employeeAId}/roles`).send({ roleId: role.id }),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(new Set(responses.map(({ body }) => body.data.id)).size).toBe(1);
    expect(await client.employeeRole.count()).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-role-assigned' } })).toBe(1);
  });

  it('allows different roles to be assigned concurrently without overwrite', async () => {
    const roleA = await createRole('concurrent-a', 'Concurrent A');
    const roleB = await createRole('concurrent-b', 'Concurrent B');
    const responses = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/employees/${employeeAId}/roles`).send({ roleId: roleA.id }),
      request(app.getHttpServer()).post(`/api/v1/employees/${employeeAId}/roles`).send({ roleId: roleB.id }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 201]);
    expect(await repository.listEffectiveRolesForEmployee(organizationAId, employeeAId, now)).toHaveLength(2);
  });

  it('has a safe serialized outcome for remove versus duplicate assign', async () => {
    const role = await createRole('remove-race', 'Remove Race');
    await assign(employeeAId, role.id);
    const responses = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/employees/${employeeAId}/roles`).send({ roleId: role.id }),
      request(app.getHttpServer()).post(`/api/v1/employees/${employeeAId}/roles/${role.id}/remove`),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    const effective = await repository.listEffectiveRolesForEmployee(organizationAId, employeeAId, now);
    expect(effective.length).toBeLessThanOrEqual(1);
    expect(await client.employeeRole.count()).toBeGreaterThanOrEqual(1);
  });

  it('serializes role archive versus assignment so no archived role remains effective', async () => {
    const role = await createRole('archive-race', 'Archive Race');
    const responses = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/roles/${role.id}/archive`),
      request(app.getHttpServer()).post(`/api/v1/employees/${employeeAId}/roles`).send({ roleId: role.id }),
    ]);
    expect(responses.map(({ status }) => status).every((status) => [200, 201, 409].includes(status))).toBe(true);
    expect(await repository.listEffectiveRolesForEmployee(organizationAId, employeeAId, now)).toHaveLength(0);
    expect((await client.role.findUniqueOrThrow({ where: { id: role.id } })).archivedAt).not.toBeNull();
  });

  it('rolls role creation, update, assignment, and removal back when required audit fails', async () => {
    const audit = app.get<AuditEventAppendPort>(AUDIT_EVENT_APPEND_PORT);
    vi.spyOn(audit, 'append').mockRejectedValueOnce(new Error('forced create audit failure'));
    await request(app.getHttpServer())
      .post('/api/v1/roles')
      .send({ key: 'rollback-create', name: 'Rollback Create' })
      .expect(500);
    expect(await client.role.count()).toBe(0);
    expect(await client.auditEvent.count()).toBe(0);
    expect(await client.outboxEvent.count()).toBe(0);
    vi.restoreAllMocks();

    const role = await createRole('rollback', 'Rollback');
    const auditBeforeUpdate = await client.auditEvent.count();
    const outboxBeforeUpdate = await client.outboxEvent.count();
    vi.spyOn(audit, 'append').mockRejectedValueOnce(new Error('forced update audit failure'));
    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${role.id}`)
      .send({ name: 'Should Roll Back' })
      .expect(500);
    expect((await client.role.findUniqueOrThrow({ where: { id: role.id } })).name).toBe('Rollback');
    expect(await client.auditEvent.count()).toBe(auditBeforeUpdate);
    expect(await client.outboxEvent.count()).toBe(outboxBeforeUpdate);
    vi.restoreAllMocks();

    vi.spyOn(audit, 'append').mockRejectedValueOnce(new Error('forced assignment audit failure'));
    await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeAId}/roles`)
      .send({ roleId: role.id })
      .expect(500);
    expect(await client.employeeRole.count()).toBe(0);
    vi.restoreAllMocks();

    await assign(employeeAId, role.id);
    const auditBeforeRemoval = await client.auditEvent.count();
    const outboxBeforeRemoval = await client.outboxEvent.count();
    vi.spyOn(audit, 'append').mockRejectedValueOnce(new Error('forced removal audit failure'));
    await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeAId}/roles/${role.id}/remove`)
      .expect(500);
    expect((await client.employeeRole.findFirstOrThrow()).removedAt).toBeNull();
    expect(await client.auditEvent.count()).toBe(auditBeforeRemoval);
    expect(await client.outboxEvent.count()).toBe(outboxBeforeRemoval);
  });

  it('leaves no false audit or outbox history when each role persistence stage is forced to fail', async () => {
    const role = await createRole('persistence-baseline', 'Persistence Baseline');
    const assignment = await assign(employeeAId, role.id);
    const baseline = {
      roles: await client.role.count(),
      assignments: await client.employeeRole.count(),
      audits: await client.auditEvent.count(),
      outbox: await client.outboxEvent.count(),
    };
    await client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_t05_role_persistence() RETURNS trigger AS $$
      BEGIN
        IF TG_TABLE_NAME = 'roles' AND TG_OP = 'INSERT' AND NEW.role_key = 'persistence-failure' THEN
          RAISE EXCEPTION 'forced role create persistence failure';
        END IF;
        IF TG_TABLE_NAME = 'roles' AND TG_OP = 'UPDATE' AND NEW.name = 'Persistence Failure' THEN
          RAISE EXCEPTION 'forced role update persistence failure';
        END IF;
        IF TG_TABLE_NAME = 'employee_roles' AND TG_OP = 'INSERT' THEN
          RAISE EXCEPTION 'forced assignment persistence failure';
        END IF;
        IF TG_TABLE_NAME = 'employee_roles' AND TG_OP = 'UPDATE' AND NEW.removed_at IS NOT NULL THEN
          RAISE EXCEPTION 'forced removal persistence failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_t05_role_persistence
      BEFORE INSERT OR UPDATE ON roles
      FOR EACH ROW EXECUTE FUNCTION reject_t05_role_persistence();
      CREATE TRIGGER reject_t05_assignment_persistence
      BEFORE INSERT OR UPDATE ON employee_roles
      FOR EACH ROW EXECUTE FUNCTION reject_t05_role_persistence();
    `);
    try {
      await request(app.getHttpServer())
        .post('/api/v1/roles')
        .send({ key: 'persistence-failure', name: 'Create Failure' })
        .expect(500);
      await request(app.getHttpServer())
        .patch(`/api/v1/roles/${role.id}`)
        .send({ name: 'Persistence Failure' })
        .expect(500);
      await request(app.getHttpServer())
        .post(`/api/v1/employees/${employeeA2Id}/roles`)
        .send({ roleId: role.id })
        .expect(500);
      await request(app.getHttpServer())
        .post(`/api/v1/employees/${employeeAId}/roles/${role.id}/remove`)
        .expect(500);

      expect(await client.role.count()).toBe(baseline.roles);
      expect((await client.role.findUniqueOrThrow({ where: { id: role.id } })).name).toBe(
        'Persistence Baseline',
      );
      expect(await client.employeeRole.count()).toBe(baseline.assignments);
      expect((await client.employeeRole.findUniqueOrThrow({ where: { id: assignment.id } })).removedAt).toBeNull();
      expect(await client.auditEvent.count()).toBe(baseline.audits);
      expect(await client.outboxEvent.count()).toBe(baseline.outbox);
    } finally {
      await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_t05_role_persistence ON roles');
      await client.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS reject_t05_assignment_persistence ON employee_roles',
      );
      await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_t05_role_persistence()');
    }
  });

  it('rolls the mutation and provisional audit back when outbox persistence fails', async () => {
    await client.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_t05_outbox_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.event_type LIKE 'identity.role-%' THEN
          RAISE EXCEPTION 'forced role outbox failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_t05_outbox_insert
      BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION reject_t05_outbox_insert();
    `);
    try {
      await request(app.getHttpServer())
        .post('/api/v1/roles')
        .send({ key: 'outbox-failure', name: 'Outbox Failure' })
        .expect(500);
      expect(await client.role.count()).toBe(0);
      expect(await client.auditEvent.count()).toBe(0);
      expect(await client.outboxEvent.count()).toBe(0);
    } finally {
      await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_t05_outbox_insert ON outbox_events');
      await client.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_t05_outbox_insert()');
    }
  });

  it('persists the five minimal outbox contracts and matching durable audit actions', async () => {
    const role = await createRole('events', 'Events', 'Must never enter an event payload');
    await request(app.getHttpServer()).patch(`/api/v1/roles/${role.id}`).send({ name: 'Event Role' }).expect(200);
    const assignment = await assign(employeeAId, role.id);
    await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeAId}/roles/${role.id}/remove`)
      .expect(200);
    await request(app.getHttpServer()).post(`/api/v1/roles/${role.id}/archive`).expect(200);
    const events = await client.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(5);
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'identity.role-created',
        'identity.role-updated',
        'identity.employee-role-assigned',
        'identity.employee-role-removed',
        'identity.role-archived',
      ]),
    );
    const serialized = JSON.stringify(events.map(({ payload }) => payload));
    expect(serialized).not.toContain('Must never enter an event payload');
    expect(serialized).not.toContain('employee-one@example.com');
    expect(serialized).not.toContain('Event Role');
    expect(serialized).toContain(assignment.id);
    expect(await client.auditEvent.count()).toBe(5);
  });

  it('documents exactly the T05 route surface and exposes no destructive or permission endpoints', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/openapi.json').expect(200);
    const document = response.body.data ?? response.body;
    expect(document.paths['/api/v1/roles'].get).toBeDefined();
    expect(document.paths['/api/v1/roles'].post).toBeDefined();
    expect(document.paths['/api/v1/roles/{id}'].patch).toBeDefined();
    expect(document.paths['/api/v1/roles/{id}'].delete).toBeUndefined();
    expect(document.paths['/api/v1/roles/{id}/archive'].post).toBeDefined();
    expect(document.paths['/api/v1/employees/{id}/roles'].post).toBeDefined();
    expect(document.paths['/api/v1/employees/{employeeId}/roles/{roleId}/remove'].post).toBeDefined();
    expect(JSON.stringify(document.paths)).not.toMatch(/role-permission|permissions\/|authorize-debug/iu);
  });
});
