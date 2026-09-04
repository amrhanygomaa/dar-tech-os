import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { createPrismaClient, type DatabaseClient } from '@dar-tech/database';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from '../app.module.js';
import { AuthorizationActorContext } from './authorization-context.js';
import { IdentityService } from '../identity/identity.service.js';
import { PERMISSION_REGISTRY } from '../permissions/permission-manifest.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import { SessionService } from '../sessions/session.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const now = new Date('2026-09-03T12:00:00.000Z');
const organizationAId = '018f53d4-2f68-7c52-a399-3df2364df001';
const organizationBId = '018f53d4-2f68-7c52-a399-3df2364df002';
const actorEmployeeId = '018f53d4-2f68-7c52-a399-3df2364df011';
const targetEmployeeId = '018f53d4-2f68-7c52-a399-3df2364df012';
const foreignEmployeeId = '018f53d4-2f68-7c52-a399-3df2364df013';
const actorAccountId = '018f53d4-2f68-7c52-a399-3df2364df021';
const foreignAccountId = '018f53d4-2f68-7c52-a399-3df2364df022';
const sessionId = '018f53d4-2f68-7c52-a399-3df2364df031';
const credential = Buffer.alloc(32, 19).toString('base64url');
const credentialHash = createHash('sha256').update(credential).digest('hex');

const config: ApiConfig = {
  runtime: 'api',
  appEnvironment: 'test',
  nodeEnvironment: 'test',
  logLevel: 'error',
  port: 3001,
  databaseUrl: databaseUrl ?? 'postgresql://test:test@127.0.0.1:5432/test',
  databasePoolMax: 8,
  databaseConnectTimeoutMs: 2_000,
  databaseIdleTimeoutMs: 2_000,
  authentication: {
    allowedRedirectUris: ['http://localhost:3000/auth/callback/local'],
    localProviderEnabled: false,
    localIdentities: [],
    transactionTtlSeconds: 300,
  },
  invitation: { ttlSeconds: 300, rateLimitMaxRequests: 100, rateLimitWindowSeconds: 60 },
  session: {
    idleTtlSeconds: 300,
    absoluteTtlSeconds: 3600,
    allowedOrigins: ['http://localhost:3000'],
    secureCookie: false,
  },
};

async function clearData(client: DatabaseClient): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_events", "security_events", "sessions", "role_permissions", "employee_roles", "permissions", "roles", "invitations", "sso_identities", "user_accounts", "employees", "organizations"',
  );
  await client.outboxConsumerReceipt.deleteMany();
  await client.outboxEvent.deleteMany();
  await client.queueJob.deleteMany();
}

describe.skipIf(!databaseUrl)('S02-T07 central authorization PostgreSQL integration', () => {
  let client: DatabaseClient;
  let app: INestApplication;
  let roleId: string;
  let assignmentId: string;

  beforeAll(async () => {
    client = createPrismaClient({ databaseUrl: databaseUrl as string });
    const contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'test',
      level: 'error',
      destination: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    });
    app = await NestFactory.create(
      AppModule.register(config, { contextStore, logger }, {
        sessionTestAdapters: { clock: { now: () => now } },
        authorizationTestAdapters: { clock: { now: () => now } },
      }),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger, config.session.allowedOrigins);
    await app.init();
  });

  beforeEach(async () => {
    await clearData(client);
    await client.organization.createMany({
      data: [
        { id: organizationAId, displayName: 'Organization A' },
        { id: organizationBId, displayName: 'Organization B' },
      ],
    });
    await client.employee.createMany({
      data: [
        {
          id: actorEmployeeId,
          organizationId: organizationAId,
          employeeCode: 'A-ACTOR',
          firstName: 'Actor',
          lastName: 'Employee',
          displayName: 'Actor Employee',
          workEmail: 'actor@example.com',
          lifecycleStatus: 'ACTIVE',
          activatedAt: now,
        },
        {
          id: targetEmployeeId,
          organizationId: organizationAId,
          employeeCode: 'A-TARGET',
          firstName: 'Target',
          lastName: 'Employee',
          displayName: 'Target Employee',
          workEmail: 'target@example.com',
          lifecycleStatus: 'ACTIVE',
          activatedAt: now,
        },
        {
          id: foreignEmployeeId,
          organizationId: organizationBId,
          employeeCode: 'B-TARGET',
          firstName: 'Foreign',
          lastName: 'Employee',
          displayName: 'Foreign Employee',
          workEmail: 'foreign@example.com',
          lifecycleStatus: 'ACTIVE',
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
    await client.permission.createMany({ data: PERMISSION_REGISTRY.map((definition) => ({ ...definition })) });
    const role = await client.role.create({
      data: {
        organizationId: organizationAId,
        key: 'operator',
        name: 'Operator',
        normalizedName: 'operator',
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
    assignmentId = assignment.id;
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
        assuranceLevel: 'mfa',
      },
    });
  });

  afterAll(async () => {
    if (client) await clearData(client);
    if (app) await app.close();
    if (client) await client.$disconnect();
  });

  async function grant(permissionKey: string, scopeType: 'SELF' | 'ORGANIZATION' | 'EXPLICIT' = 'ORGANIZATION', binding?: { type: string; id: string }) {
    const permission = await client.permission.findUniqueOrThrow({ where: { key: permissionKey } });
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
    return request(app.getHttpServer()).get(path).set('Cookie', `dartech_session=${credential}`);
  }

  it('uses the T04 principal, current T05/T06 grants, and no session authority snapshot', async () => {
    const currentGrant = await grant('admin.employee.read');
    await get('/api/v1/employees').expect(200);

    await client.rolePermission.update({ where: { id: currentGrant.id }, data: { removedAt: now, removedByEmployeeId: actorEmployeeId } });
    await get('/api/v1/employees').expect(403);

    const replacement = await grant('admin.employee.read');
    await get('/api/v1/employees').expect(200);
    await client.employeeRole.update({ where: { id: assignmentId }, data: { removedAt: now, removedByEmployeeId: actorEmployeeId } });
    await get('/api/v1/employees').expect(403);

    await client.employeeRole.create({
      data: { organizationId: organizationAId, employeeId: actorEmployeeId, roleId, assignedByEmployeeId: actorEmployeeId, assignedAt: now, effectiveAt: now },
    });
    await get('/api/v1/employees').expect(200);
    await client.role.update({ where: { id: roleId }, data: { archivedAt: now } });
    await get('/api/v1/employees').expect(403);
    expect(replacement.id).toBeTruthy();
  });

  it('unions a newly added second role immediately for the same session', async () => {
    await grant('admin.employee.read');
    await get('/api/v1/audit-events').expect(403);
    const auditPermission = await client.permission.findUniqueOrThrow({ where: { key: 'audit.event.read' } });
    const secondRole = await client.role.create({ data: { organizationId: organizationAId, key: 'auditor', name: 'Auditor', normalizedName: 'auditor' } });
    await client.employeeRole.create({ data: { organizationId: organizationAId, employeeId: actorEmployeeId, roleId: secondRole.id, assignedByEmployeeId: actorEmployeeId, assignedAt: now, effectiveAt: now } });
    await client.rolePermission.create({ data: { organizationId: organizationAId, roleId: secondRole.id, permissionId: auditPermission.id, scopeType: 'ORGANIZATION', grantedByEmployeeId: actorEmployeeId, grantedAt: now, effectiveAt: now } });
    await get('/api/v1/audit-events').expect(200);
    await get('/api/v1/employees').expect(200);
  });

  it('integrates all current protected read domains through the one engine', async () => {
    const domains = [
      ['/api/v1/me', 'identity.account.read_self'],
      ['/api/v1/me/sessions', 'identity.session.read_self'],
      ['/api/v1/employees', 'admin.employee.read'],
      ['/api/v1/invitations', 'admin.invitation.read'],
      ['/api/v1/roles', 'admin.role.read'],
      ['/api/v1/permissions', 'admin.permission.read'],
      ['/api/v1/audit-events', 'audit.event.read'],
      ['/api/v1/security-events', 'security.event.read'],
      ['/api/v1/admin/sessions', 'admin.session.read'],
    ] as const;

    for (const [path] of domains) {
      await get(path).expect(403);
      await request(app.getHttpServer()).get(path).expect(401);
    }
    for (const [, permissionKey] of domains) {
      await grant(permissionKey, permissionKey.startsWith('identity.') ? 'SELF' : 'ORGANIZATION');
    }

    await get('/api/v1/me').expect(200);
    await get('/api/v1/me/sessions').expect(200);
    await get('/api/v1/employees').expect(200);
    await get('/api/v1/invitations').expect(200);
    await get('/api/v1/roles').expect(200);
    await get('/api/v1/permissions').expect(200);
    await get('/api/v1/audit-events').expect(200);
    await get('/api/v1/security-events').expect(200);
    await get('/api/v1/admin/sessions').expect(200);
  });

  it('supports exact EXPLICIT binding and retains safe cross-organization not-found behavior', async () => {
    await grant('admin.employee.read', 'EXPLICIT', { type: 'employee', id: targetEmployeeId });
    await get(`/api/v1/employees/${targetEmployeeId}`).expect(200);
    await get(`/api/v1/employees/${actorEmployeeId}`).expect(403);
    await get(`/api/v1/employees/${foreignEmployeeId}`).expect(403);

    await client.rolePermission.deleteMany();
    await grant('admin.employee.read');
    await get(`/api/v1/employees/${foreignEmployeeId}`).expect(404);

    await grant('admin.employee.update');
    await request(app.getHttpServer())
      .patch(`/api/v1/employees/${foreignEmployeeId}`)
      .set('Cookie', `dartech_session=${credential}`)
      .set('Origin', 'http://localhost:3000')
      .send({ displayName: 'Cross Organization Mutation' })
      .expect(404);
    await expect(client.employee.findUniqueOrThrow({ where: { id: foreignEmployeeId } }))
      .resolves.toMatchObject({ displayName: 'Foreign Employee' });
  });

  it('requires current permissions and cannot bypass protected services outside HTTP context', async () => {
    const actor = {
      sessionId,
      organizationId: organizationAId,
      userAccountId: actorAccountId,
      employeeId: actorEmployeeId,
      clientKind: 'browser' as const,
      assuranceLevel: 'mfa',
      authenticatedAt: now,
      lastStepUpAt: null,
      issuedAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + 300_000),
      absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
      actorType: 'employee' as const,
    };
    const context = app.get(AuthorizationActorContext);
    const identity = app.get(IdentityService);

    await expect(context.run(actor, () => identity.getMe()))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await grant('identity.account.read_self', 'SELF');
    await expect(identity.getMe()).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    await expect(context.run(actor, () => identity.getMe()))
      .resolves.toMatchObject({ employee: { id: actorEmployeeId } });
    await expect(
      app.get(SessionService).listSelf(actor),
    ).rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_DENIED' });
  });

  it('enforces exact-Origin CSRF before protected mutation and leaves public onboarding outside it', async () => {
    await grant('identity.account.update_self', 'SELF');
    const auditCountBefore = await client.auditEvent.count({ where: { organizationId: organizationAId } });
    const outboxCountBefore = await client.outboxEvent.count();
    const securityCountBefore = await client.securityEvent.count({ where: { organizationId: organizationAId } });

    // --- 1. VALID SESSION + FOREIGN ORIGIN ---
    const sessionBeforeForeign = await client.session.findUniqueOrThrow({ where: { id: sessionId } });
    await request(app.getHttpServer()).patch('/api/v1/me').set('Cookie', `dartech_session=${credential}`).set('Origin', 'https://foreign.example').send({ displayName: 'Blocked Foreign' }).expect(403);
    const sessionAfterForeign = await client.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(sessionAfterForeign.lastSeenAt.getTime()).toBe(sessionBeforeForeign.lastSeenAt.getTime());
    expect(sessionAfterForeign.idleExpiresAt.getTime()).toBe(sessionBeforeForeign.idleExpiresAt.getTime());
    expect((await client.employee.findUniqueOrThrow({ where: { id: actorEmployeeId } })).displayName).toBe('Actor Employee');
    await expect(client.auditEvent.count({ where: { organizationId: organizationAId } }))
      .resolves.toBe(auditCountBefore);
    await expect(client.securityEvent.count({ where: { organizationId: organizationAId } }))
      .resolves.toBe(securityCountBefore);
    await expect(client.outboxEvent.count()).resolves.toBe(outboxCountBefore);

    // --- 2. VALID SESSION + MISSING ORIGIN ---
    const sessionBeforeMissing = await client.session.findUniqueOrThrow({ where: { id: sessionId } });
    await request(app.getHttpServer()).patch('/api/v1/me').set('Cookie', `dartech_session=${credential}`).send({ displayName: 'Blocked Missing' }).expect(403);
    const sessionAfterMissing = await client.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(sessionAfterMissing.lastSeenAt.getTime()).toBe(sessionBeforeMissing.lastSeenAt.getTime());
    expect(sessionAfterMissing.idleExpiresAt.getTime()).toBe(sessionBeforeMissing.idleExpiresAt.getTime());
    expect((await client.employee.findUniqueOrThrow({ where: { id: actorEmployeeId } })).displayName).toBe('Actor Employee');
    await expect(client.auditEvent.count({ where: { organizationId: organizationAId } }))
      .resolves.toBe(auditCountBefore);
    await expect(client.securityEvent.count({ where: { organizationId: organizationAId } }))
      .resolves.toBe(securityCountBefore);
    await expect(client.outboxEvent.count()).resolves.toBe(outboxCountBefore);

    // --- 3. VALID SESSION + ALLOWED ORIGIN ---
    await request(app.getHttpServer()).patch('/api/v1/me').set('Cookie', `dartech_session=${credential}`).set('Origin', 'http://localhost:3000').send({ displayName: 'Allowed Origin' }).expect(200);
    expect((await client.employee.findUniqueOrThrow({ where: { id: actorEmployeeId } })).displayName).toBe('Allowed Origin');

    // --- 4. PROTECTED GET (no mutation CSRF required) ---
    await grant('identity.account.read_self', 'SELF');
    await request(app.getHttpServer()).get('/api/v1/me').set('Cookie', `dartech_session=${credential}`).expect(200);

    // --- 5. PUBLIC ONBOARDING REGRESSION ---
    await request(app.getHttpServer()).post('/api/v1/onboarding/invitation/inspect').send({ invitation: 'invalid' }).expect(400);
  });

  it('keeps role names authority-free and rejects missing sessions before use cases execute', async () => {
    await client.role.update({ where: { id: roleId }, data: { name: 'Super Admin', normalizedName: 'super admin' } });
    await get('/api/v1/employees').expect(403);
    await request(app.getHttpServer()).get('/api/v1/employees').expect(401);
  });
});
