import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import {
  createPrismaClient,
  EmployeeLifecycleStatus,
  Prisma,
  type DatabaseClient,
} from '@dar-tech/database';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from '../app.module.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import {
  type IdentityAuditHook,
  type IdentityRepositoryPort,
  type TrustedActor,
} from '../identity/identity.contracts.js';
import { DurableIdentityAuditHook } from '../identity/identity-security.adapters.js';
import { PrismaIdentityRepository } from '../identity/prisma-identity.repository.js';
import { PrismaIdentityTransactionAdapter } from '../identity/prisma-identity-transaction.adapter.js';
import { IdentityService } from '../identity/identity.service.js';
import {
  AUDIT_EVENT_APPEND_PORT,
  SECURITY_EVENT_APPEND_PORT,
  type AuditEventAppendPort,
  type SecurityEventAppendPort,
} from './event-history.contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const orgAId = '028f53d4-2f68-7c52-a399-3df2364d8801';
const orgBId = '028f53d4-2f68-7c52-a399-3df2364d8802';
const actorEmployeeId = '028f53d4-2f68-7c52-a399-3df2364d8811';
const targetEmployeeId = '028f53d4-2f68-7c52-a399-3df2364d8812';
const orgBEmployeeId = '028f53d4-2f68-7c52-a399-3df2364d8813';
const actorAccountId = '028f53d4-2f68-7c52-a399-3df2364d8821';
const orgBAccountId = '028f53d4-2f68-7c52-a399-3df2364d8822';
const actorSSOId = '028f53d4-2f68-7c52-a399-3df2364d8831';
const redirectUri = 'http://localhost:3000/auth/callback';
const actor: TrustedActor = {
  actorType: 'employee',
  organizationId: orgAId,
  employeeId: actorEmployeeId,
  userAccountId: actorAccountId,
};

async function clearFixtures(client: DatabaseClient): Promise<void> {
  await client.$executeRawUnsafe('TRUNCATE TABLE "approval_history_entries", "approval_steps", "approval_requests", "audit_events", "security_events"');
  await client.session.deleteMany();
  await client.sSOIdentity.deleteMany();
  await client.userAccount.deleteMany();
  await client.employee.deleteMany();
  await client.organization.deleteMany();
}

async function createFixtures(client: DatabaseClient): Promise<void> {
  await client.organization.createMany({
    data: [
      { id: orgAId, displayName: 'Organization A' },
      { id: orgBId, displayName: 'Organization B' },
    ],
  });
  await client.employee.createMany({
    data: [
      {
        id: actorEmployeeId,
        organizationId: orgAId,
        employeeCode: 'A-001',
        firstName: 'Historical',
        lastName: 'Actor',
        displayName: 'Historical Actor',
        workEmail: 'actor@orga.example',
        lifecycleStatus: EmployeeLifecycleStatus.ACTIVE,
        activatedAt: new Date('2026-09-01T08:00:00.000Z'),
      },
      {
        id: targetEmployeeId,
        organizationId: orgAId,
        employeeCode: 'A-002',
        firstName: 'Target',
        lastName: 'Employee',
        displayName: 'Target Employee',
        workEmail: 'target@orga.example',
      },
      {
        id: orgBEmployeeId,
        organizationId: orgBId,
        employeeCode: 'B-001',
        firstName: 'Other',
        lastName: 'Employee',
        displayName: 'Other Employee',
        workEmail: 'employee@orgb.example',
        lifecycleStatus: EmployeeLifecycleStatus.ACTIVE,
        activatedAt: new Date('2026-09-01T08:00:00.000Z'),
      },
    ],
  });
  await client.userAccount.createMany({
    data: [
      {
        id: actorAccountId,
        organizationId: orgAId,
        employeeId: actorEmployeeId,
        authenticationEligible: true,
        activatedAt: new Date('2026-09-01T08:00:00.000Z'),
      },
      {
        id: orgBAccountId,
        organizationId: orgBId,
        employeeId: orgBEmployeeId,
        authenticationEligible: true,
        activatedAt: new Date('2026-09-01T08:00:00.000Z'),
      },
    ],
  });
  await client.sSOIdentity.create({
    data: {
      id: actorSSOId,
      organizationId: orgAId,
      userAccountId: actorAccountId,
      providerKey: 'local',
      providerSubject: 'local-audit-subject',
      verifiedEmailNormalized: 'actor@orga.example',
    },
  });
}

describe.skipIf(!databaseUrl)('S02-T12 audit and security event PostgreSQL integration', () => {
  let client: DatabaseClient;
  let app: INestApplication;
  let auditEvents: AuditEventAppendPort;
  let securityEvents: SecurityEventAppendPort;
  let contextStore: RequestContextStore;
  let logger: StructuredLogger;
  let logOutput = '';

  beforeAll(async () => {
    client = createPrismaClient({ databaseUrl: databaseUrl as string });
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logOutput += chunk.toString();
        callback();
      },
    });
    contextStore = new RequestContextStore();
    logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'test',
      level: 'info',
      destination,
    });
    const config: ApiConfig = {
      runtime: 'api',
      appEnvironment: 'test',
      nodeEnvironment: 'test',
      logLevel: 'info',
      port: 3001,
      databaseUrl: databaseUrl as string,
      databasePoolMax: 4,
      databaseConnectTimeoutMs: 2_000,
      databaseIdleTimeoutMs: 2_000,
      authentication: {
        allowedRedirectUris: [redirectUri],
        localProviderEnabled: true,
        localIdentities: [
          {
            loginHint: 'employee',
            providerSubject: 'local-audit-subject',
            verifiedEmail: 'actor@orga.example',
          },
        ],
        transactionTtlSeconds: 300,
      },
      invitation: { ttlSeconds: 300, rateLimitMaxRequests: 30, rateLimitWindowSeconds: 60 },
      session: { idleTtlSeconds: 300, absoluteTtlSeconds: 3600, allowedOrigins: ['http://localhost:3000'], secureCookie: false },
    };
    app = await NestFactory.create(
      AppModule.register(
        config,
        { contextStore, logger },
        {
          identityTestAdapters: {
            actors: { currentActor: () => Promise.resolve(actor) },
            authorization: { authorize: () => Promise.resolve(true) },
          },
          eventHistoryTestAdapters: {
            actors: { currentActor: () => Promise.resolve(actor) },
            authorization: { authorize: () => Promise.resolve(true) },
          },
        },
      ),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger);
    await app.init();
    auditEvents = app.get<AuditEventAppendPort>(AUDIT_EVENT_APPEND_PORT);
    securityEvents = app.get<SecurityEventAppendPort>(SECURITY_EVENT_APPEND_PORT);
  });

  beforeEach(async () => {
    logOutput = '';
    await clearFixtures(client);
    await createFixtures(client);
  });

  afterAll(async () => {
    if (client) await clearFixtures(client);
    if (app) await app.close();
    if (client) await client.$disconnect();
  });

  it('persists both entities with restrictive organization relations and no secret columns', async () => {
    await auditEvents.append({
      organizationId: orgAId,
      actionKey: 'admin.employee.update',
      actorEmployeeId,
      actorSnapshot: {
        type: 'employee',
        displayName: 'Historical Actor',
        employeeCode: 'A-001',
      },
      targetType: 'employee',
      targetId: targetEmployeeId,
      correlationId: 'audit-correlation',
      changeDelta: { changedFields: ['displayName'] },
    });
    await securityEvents.append({
      organizationId: orgAId,
      eventType: 'AuthenticationSucceeded.v1',
      category: 'authentication',
      risk: 'LOW',
      outcome: 'succeeded',
      actorEmployeeId,
      actorAccountId,
      providerKey: 'local',
      actorSnapshot: {
        type: 'employee',
        displayName: 'Historical Actor',
        employeeCode: 'A-001',
      },
      safeContext: { assuranceLevel: 'local-development' },
      correlationId: 'security-correlation',
    });
    await expect(client.auditEvent.count()).resolves.toBe(1);
    await expect(client.securityEvent.count()).resolves.toBe(1);

    const foreignKeys = await client.$queryRaw<
      Array<{ table_name: string; delete_action: string }>
    >(Prisma.sql`
      SELECT tc.table_name, rc.delete_rule AS delete_action
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_schema = tc.constraint_schema
       AND rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name IN ('audit_events', 'security_events')
    `);
    expect(foreignKeys).toHaveLength(5);
    expect(foreignKeys.every(({ delete_action }) => delete_action === 'RESTRICT')).toBe(true);

    const columns = await client.$queryRaw<Array<{ column_name: string }>>(Prisma.sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('audit_events', 'security_events')
    `);
    const columnNames = columns.map(({ column_name }) => column_name);
    for (const forbidden of [
      'password',
      'invitation_secret',
      'session_secret',
      'authorization_code',
      'access_token',
      'refresh_token',
      'provider_subject',
      'raw_provider_payload',
    ]) {
      expect(columnNames).not.toContain(forbidden);
    }
  });

  it('enforces database append-only history and exposes no PATCH or DELETE API', async () => {
    const auditEvent = await auditEvents.append({
      organizationId: orgAId,
      actionKey: 'identity.account.update_self',
      actorEmployeeId,
      actorSnapshot: {
        type: 'employee',
        displayName: 'Historical Actor',
        employeeCode: 'A-001',
      },
      targetType: 'employee',
      targetId: actorEmployeeId,
      correlationId: 'append-only-audit',
      changeDelta: { changedFields: ['displayName'] },
    });
    const securityEvent = await securityEvents.append({
      eventType: 'AuthenticationFailed.v1',
      category: 'authentication',
      risk: 'MEDIUM',
      outcome: 'failed',
      providerKey: 'local',
      safeContext: { failureCategory: 'protocol_invalid' },
      correlationId: 'append-only-security',
    });
    await expect(
      client.auditEvent.update({
        where: { id: auditEvent.id },
        data: { safeReason: 'attempted correction' },
      }),
    ).rejects.toBeTruthy();
    await expect(
      client.securityEvent.delete({ where: { id: securityEvent.id } }),
    ).rejects.toBeTruthy();
    await request(app.getHttpServer())
      .patch(`/api/v1/audit-events/${auditEvent.id}`)
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/security-events/${securityEvent.id}`)
      .expect(404);
  });

  it('isolates list/detail reads and safely hides cross-organization event existence', async () => {
    const ownAudit = await auditEvents.append({
      organizationId: orgAId,
      actionKey: 'admin.employee.update',
      actorEmployeeId,
      actorSnapshot: {
        type: 'employee',
        displayName: 'Historical Actor',
        employeeCode: 'A-001',
      },
      targetType: 'employee',
      targetId: targetEmployeeId,
      correlationId: 'own-audit',
    });
    const otherAudit = await auditEvents.append({
      organizationId: orgBId,
      actionKey: 'admin.employee.update',
      actorEmployeeId: orgBEmployeeId,
      actorSnapshot: {
        type: 'employee',
        displayName: 'Other Employee',
        employeeCode: 'B-001',
      },
      targetType: 'employee',
      targetId: orgBEmployeeId,
      correlationId: 'other-audit',
    });
    const ownSecurity = await securityEvents.append({
      organizationId: orgAId,
      eventType: 'AuthenticationSucceeded.v1',
      category: 'authentication',
      risk: 'LOW',
      outcome: 'succeeded',
      actorEmployeeId,
      actorAccountId,
      providerKey: 'local',
      correlationId: 'own-security',
    });
    const otherSecurity = await securityEvents.append({
      organizationId: orgBId,
      eventType: 'AuthenticationSucceeded.v1',
      category: 'authentication',
      risk: 'LOW',
      outcome: 'succeeded',
      actorEmployeeId: orgBEmployeeId,
      actorAccountId: orgBAccountId,
      providerKey: 'local',
      correlationId: 'other-security',
    });

    const auditList = await request(app.getHttpServer()).get('/api/v1/audit-events').expect(200);
    expect(auditList.body.data.items.map((item: { id: string }) => item.id)).toEqual([ownAudit.id]);
    const securityList = await request(app.getHttpServer())
      .get('/api/v1/security-events')
      .expect(200);
    expect(securityList.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      ownSecurity.id,
    ]);
    await request(app.getHttpServer()).get(`/api/v1/audit-events/${otherAudit.id}`).expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/security-events/${otherSecurity.id}`)
      .expect(404);
  });

  it('commits profile mutation and durable audit together with historical snapshots', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/employees/${targetEmployeeId}`)
      .send({ displayName: 'Updated Target' })
      .expect(200);
    const event = await client.auditEvent.findFirstOrThrow({
      where: { organizationId: orgAId, targetId: targetEmployeeId },
    });
    expect(event).toMatchObject({
      actionKey: 'admin.employee.update',
      requestId: response.headers['x-request-id'],
      actorEmployeeId,
      actorSnapshot: {
        type: 'employee',
        displayName: 'Historical Actor',
        employeeCode: 'A-001',
      },
      targetSnapshot: {
        displayName: 'Target Employee',
        employeeCode: 'A-002',
      },
      changeDelta: { changedFields: ['displayName'] },
    });
    await client.employee.update({
      where: { id: actorEmployeeId },
      data: {
        displayName: 'Actor Renamed Later',
        lifecycleStatus: 'SUSPENDED',
      },
    });
    await expect(
      client.auditEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toMatchObject({
      actorSnapshot: {
        type: 'employee',
        displayName: 'Historical Actor',
        employeeCode: 'A-001',
      },
    });
  });

  it('rolls back the mutation when the required audit fails', async () => {
    const repository = new PrismaIdentityRepository(client);
    const failingAudit: IdentityAuditHook = {
      record: () => Promise.reject(new Error('required audit unavailable')),
    };
    const service = new IdentityService(
      { currentActor: () => Promise.resolve(actor) },
      { authorize: () => Promise.resolve(true) },
      repository,
      failingAudit,
      new PrismaIdentityTransactionAdapter(client),
      logger,
    );
    await expect(
      service.updateEmployee(targetEmployeeId, {
        displayName: 'Must Roll Back',
      }),
    ).rejects.toThrow('required audit unavailable');
    await expect(
      client.employee.findUniqueOrThrow({ where: { id: targetEmployeeId } }),
    ).resolves.toMatchObject({ displayName: 'Target Employee' });
    await expect(client.auditEvent.count()).resolves.toBe(0);
  });

  it('rolls back a provisional audit when the mutation fails', async () => {
    const repository = new PrismaIdentityRepository(client);
    const failingRepository: IdentityRepositoryPort = {
      findSelf: repository.findSelf.bind(repository),
      listEmployees: repository.listEmployees.bind(repository),
      findEmployeeById: repository.findEmployeeById.bind(repository),
      updateEmployeeProfile: () => Promise.reject(new Error('mutation failed')),
      findAccountById: repository.findAccountById.bind(repository),
      findSSOIdentity: repository.findSSOIdentity.bind(repository),
    };
    const service = new IdentityService(
      { currentActor: () => Promise.resolve(actor) },
      { authorize: () => Promise.resolve(true) },
      failingRepository,
      new DurableIdentityAuditHook(contextStore, auditEvents),
      new PrismaIdentityTransactionAdapter(client),
      logger,
    );
    await expect(
      service.updateEmployee(targetEmployeeId, {
        displayName: 'Will Not Commit',
      }),
    ).rejects.toThrow('mutation failed');
    await expect(client.auditEvent.count()).resolves.toBe(0);
    await expect(
      client.employee.findUniqueOrThrow({ where: { id: targetEmployeeId } }),
    ).resolves.toMatchObject({ displayName: 'Target Employee' });
  });

  it('persists safe T03 success and non-enumerating failure events without protocol material', async () => {
    const started = await request(app.getHttpServer())
      .post('/api/v1/auth/local/start')
      .send({ redirectUri, loginHint: 'employee' })
      .expect(200);
    const callbackUri = new URL(started.body.data.authorizationUrl as string);
    const callbackBody = {
      transactionId: callbackUri.searchParams.get('transactionId'),
      state: callbackUri.searchParams.get('state'),
      nonce: callbackUri.searchParams.get('nonce'),
      code: callbackUri.searchParams.get('code'),
    };
    await request(app.getHttpServer())
      .post('/api/v1/auth/local/callback')
      .send(callbackBody)
      .expect(200);

    const succeeded = await client.securityEvent.findFirstOrThrow({
      where: { eventType: 'AuthenticationSucceeded.v1' },
    });
    expect(succeeded).toMatchObject({
      organizationId: orgAId,
      category: 'authentication',
      risk: 'LOW',
      outcome: 'succeeded',
      actorEmployeeId,
      actorAccountId,
      providerKey: 'local',
      actorSnapshot: {
        type: 'employee',
        displayName: 'Historical Actor',
        employeeCode: 'A-001',
      },
    });
    await client.employee.update({
      where: { id: actorEmployeeId },
      data: { displayName: 'Authentication Actor Renamed Later', lifecycleStatus: 'ARCHIVED' },
    });
    await expect(
      client.securityEvent.findUniqueOrThrow({ where: { id: succeeded.id } }),
    ).resolves.toMatchObject({
      actorSnapshot: {
        type: 'employee',
        displayName: 'Historical Actor',
        employeeCode: 'A-001',
      },
    });

    const failed = await request(app.getHttpServer())
      .post('/api/v1/auth/local/callback')
      .send(callbackBody)
      .expect(401);
    expect(failed.body.error).toEqual({
      code: 'AUTHENTICATION_FAILED',
      message: 'Authentication could not be completed',
      requestId: failed.headers['x-request-id'],
    });
    const failureEvent = await client.securityEvent.findFirstOrThrow({
      where: { eventType: 'AuthenticationFailed.v1' },
    });
    expect(failureEvent).toMatchObject({
      organizationId: null,
      category: 'authentication',
      risk: 'MEDIUM',
      outcome: 'failed',
      actorEmployeeId: null,
      actorAccountId: null,
      providerKey: 'local',
      safeContext: { failureCategory: 'replay_denied' },
    });

    const serialized = JSON.stringify([succeeded, failureEvent, logOutput]);
    expect(serialized).not.toContain(callbackBody.state);
    expect(serialized).not.toContain(callbackBody.nonce);
    expect(serialized).not.toContain(callbackBody.code);
    expect(serialized).not.toContain('actor@orga.example');
    expect(serialized).not.toContain('local-audit-subject');
  });

  it('makes persistence failures observable using bounded metric and error dimensions', async () => {
    await expect(
      auditEvents.append({
        organizationId: orgAId,
        actionKey: 'admin.employee.update',
        actorEmployeeId: orgBEmployeeId,
        actorSnapshot: {
          type: 'employee',
          displayName: 'Other',
          employeeCode: 'B-001',
        },
        targetType: 'employee',
        targetId: targetEmployeeId,
        correlationId: 'failure-observability',
      }),
    ).rejects.toBeTruthy();
    expect(logOutput).toContain('eventhistory.metric.write');
    expect(logOutput).toContain('eventhistory.audit.persistence_failed');
    const failureLines = logOutput
      .split('\n')
      .filter((line) => line.includes('eventhistory.audit.persistence_failed'))
      .join('\n');
    expect(failureLines).not.toMatch(/employeeId|email|providerSubject|reason|token/iu);
  });
});
