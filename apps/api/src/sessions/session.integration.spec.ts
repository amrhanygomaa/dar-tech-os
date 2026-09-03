import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { createPrismaClient, type DatabaseClient } from '@dar-tech/database';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import {
  AUDIT_EVENT_APPEND_PORT,
  SECURITY_EVENT_APPEND_PORT,
  type AuditEventAppendPort,
  type SecurityEventAppendPort,
} from '../event-history/event-history.contracts.js';
import { AppModule } from '../app.module.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import { PrismaSessionRepository } from './prisma-session.repository.js';
import { CryptographicSessionCredentialGenerator } from './session-secret.js';
import { SessionService } from './session.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const organizationA = '018f53d4-2f68-7c52-a399-3df2364d8701';
const employeeA = '018f53d4-2f68-7c52-a399-3df2364d8702';
const accountA = '018f53d4-2f68-7c52-a399-3df2364d8703';
const organizationB = '018f53d4-2f68-7c52-a399-3df2364d8711';
const employeeB = '018f53d4-2f68-7c52-a399-3df2364d8712';
const accountB = '018f53d4-2f68-7c52-a399-3df2364d8713';
const initialNow = new Date('2026-09-03T10:00:00.000Z');

const config: ApiConfig = {
  runtime: 'api', appEnvironment: 'test', nodeEnvironment: 'test', logLevel: 'info', port: 3001,
  databaseUrl: databaseUrl ?? 'postgresql://unavailable',
  databasePoolMax: 4, databaseConnectTimeoutMs: 5_000, databaseIdleTimeoutMs: 30_000,
  authentication: { allowedRedirectUris: [], localProviderEnabled: false, localIdentities: [], transactionTtlSeconds: 300 },
  invitation: { ttlSeconds: 300, rateLimitMaxRequests: 100, rateLimitWindowSeconds: 60 },
  session: { idleTtlSeconds: 300, absoluteTtlSeconds: 900, allowedOrigins: ['http://localhost:3000'], secureCookie: false },
};

async function clearData(client: DatabaseClient): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE TABLE "outbox_consumer_receipts", "outbox_events", "queue_jobs", "audit_events", "security_events", "sessions", "role_permissions", "employee_roles", "permissions", "roles", "invitations", "sso_identities", "user_accounts", "employees", "organizations"',
  );
}

async function seedIdentity(client: DatabaseClient): Promise<void> {
  await client.organization.createMany({ data: [
    { id: organizationA, displayName: 'Organization A' },
    { id: organizationB, displayName: 'Organization B' },
  ] });
  await client.employee.createMany({ data: [
    { id: employeeA, organizationId: organizationA, employeeCode: 'EMP-A', firstName: 'A', lastName: 'Actor', displayName: 'Actor A', workEmail: 'a@example.com', lifecycleStatus: 'ACTIVE', activatedAt: initialNow },
    { id: employeeB, organizationId: organizationB, employeeCode: 'EMP-B', firstName: 'B', lastName: 'Actor', displayName: 'Actor B', workEmail: 'b@example.com', lifecycleStatus: 'ACTIVE', activatedAt: initialNow },
  ] });
  await client.userAccount.createMany({ data: [
    { id: accountA, organizationId: organizationA, employeeId: employeeA, authenticationEligible: true, activatedAt: initialNow },
    { id: accountB, organizationId: organizationB, employeeId: employeeB, authenticationEligible: true, activatedAt: initialNow },
  ] });
}

describe.skipIf(!databaseUrl)('S02-T04 session PostgreSQL integration', () => {
  let client: DatabaseClient;
  let app: INestApplication;
  let service: SessionService;
  let repository: PrismaSessionRepository;
  let currentTime = initialNow;
  let contextStore: RequestContextStore;

  beforeAll(async () => {
    client = createPrismaClient({ databaseUrl: databaseUrl as string });
    contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api', environment: 'test', level: 'info',
      destination: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    });
    app = await NestFactory.create(
      AppModule.register(config, { contextStore, logger }, {
        sessionTestAdapters: {
          clock: { now: () => currentTime },
          administrationAuthorization: { allows: () => Promise.resolve(true) },
        },
      }),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger, config.session.allowedOrigins);
    await app.init();
    service = app.get(SessionService);
    repository = app.get(PrismaSessionRepository);
  });

  beforeEach(async () => {
    currentTime = initialNow;
    await clearData(client);
    await seedIdentity(client);
  });

  afterAll(async () => {
    await app.close();
    await client.$disconnect();
  });

  async function establishA() {
    return service.establish(
      { organizationId: organizationA, employeeId: employeeA, userAccountId: accountA },
      { assurance: { level: 'mfa', methods: ['otp'] }, authenticatedAt: initialNow },
      { status: 'missing' },
    );
  }

  it('persists only a digest and atomically writes safe creation history and outbox', async () => {
    const established = await establishA();
    expect(established.cookie.kind).toBe('set');
    const raw = established.cookie.credential as string;
    const stored = await client.session.findUniqueOrThrow({
      where: { id: established.principal.sessionId },
    });
    expect(stored.credentialHash).toHaveLength(64);
    expect(stored.credentialHash).not.toContain(raw);
    expect(stored.lastStepUpAt).toBeNull();
    expect(stored.idleExpiresAt).toEqual(new Date(initialNow.getTime() + 300_000));
    expect(stored.absoluteExpiresAt).toEqual(new Date(initialNow.getTime() + 900_000));
    expect(await client.auditEvent.count({ where: { targetId: stored.id } })).toBe(1);
    expect(await client.securityEvent.count({ where: { sessionReference: stored.id } })).toBe(1);
    const outbox = await client.outboxEvent.findFirstOrThrow({ where: { eventType: 'identity.session-created' } });
    expect(JSON.stringify(outbox.payload)).not.toContain(raw);
    expect(JSON.stringify(outbox.payload)).not.toContain(stored.credentialHash);
  });

  it('touches active sessions without extending beyond absolute expiry and denies equality boundaries', async () => {
    const established = await establishA();
    const raw = established.cookie.credential as string;
    currentTime = new Date(initialNow.getTime() + 120_000);
    const touched = await service.resolveCookie({ status: 'present', credential: raw });
    expect(touched.principal?.lastSeenAt).toEqual(currentTime);
    expect(touched.principal?.idleExpiresAt).toEqual(new Date(currentTime.getTime() + 300_000));

    currentTime = new Date(currentTime.getTime() + 300_000);
    await expect(service.resolveCookie({ status: 'present', credential: raw })).resolves.toEqual({
      principal: null,
      cookie: { kind: 'clear' },
    });

    const second = await establishA();
    const secondRaw = second.cookie.credential as string;
    currentTime = second.principal.absoluteExpiresAt;
    await expect(service.resolveCookie({ status: 'present', credential: secondRaw })).resolves.toEqual({
      principal: null,
      cookie: { kind: 'clear' },
    });
  });

  it('rechecks employee/account eligibility on every resolution and cannot revive an invalid session', async () => {
    const established = await establishA();
    const raw = established.cookie.credential as string;
    for (const lifecycleStatus of ['SUSPENDED', 'OFFBOARDING', 'ARCHIVED'] as const) {
      await client.employee.update({ where: { id: employeeA }, data: { lifecycleStatus } });
      expect((await service.resolveCookie({ status: 'present', credential: raw })).principal).toBeNull();
      await client.employee.update({ where: { id: employeeA }, data: { lifecycleStatus: 'ACTIVE' } });
    }
    await client.userAccount.update({ where: { id: accountA }, data: { authenticationEligible: false } });
    expect((await service.resolveCookie({ status: 'present', credential: raw })).principal).toBeNull();
    await client.userAccount.update({ where: { id: accountA }, data: { authenticationEligible: true, disabledAt: currentTime } });
    expect((await service.resolveCookie({ status: 'present', credential: raw })).principal).toBeNull();
  });

  it('denies issuance for inactive, ineligible, disabled, or mismatched ownership', async () => {
    const attempt = () => establishA();
    await client.employee.update({ where: { id: employeeA }, data: { lifecycleStatus: 'SUSPENDED' } });
    await expect(attempt()).rejects.toThrow('ineligible');
    await client.employee.update({ where: { id: employeeA }, data: { lifecycleStatus: 'ACTIVE' } });
    await client.userAccount.update({ where: { id: accountA }, data: { authenticationEligible: false } });
    await expect(attempt()).rejects.toThrow('ineligible');
    await client.userAccount.update({ where: { id: accountA }, data: { authenticationEligible: true, disabledAt: currentTime } });
    await expect(attempt()).rejects.toThrow('ineligible');
    await client.userAccount.update({ where: { id: accountA }, data: { disabledAt: null } });
    await expect(
      service.establish(
        { organizationId: organizationA, employeeId: employeeA, userAccountId: accountB },
        { assurance: { level: null, methods: [] }, authenticatedAt: null },
        { status: 'missing' },
      ),
    ).rejects.toThrow('ineligible');
    expect(await client.session.count()).toBe(0);
    expect(await client.auditEvent.count()).toBe(0);
    expect(await client.securityEvent.count()).toBe(0);
    expect(await client.outboxEvent.count()).toBe(0);
  });

  it('rotates a valid incoming session and creates distinct revocation and creation events', async () => {
    const first = await establishA();
    currentTime = new Date(initialNow.getTime() + 1_000);
    const second = await service.establish(
      { organizationId: organizationA, employeeId: employeeA, userAccountId: accountA },
      { assurance: { level: 'mfa', methods: ['otp'] }, authenticatedAt: currentTime },
      { status: 'present', credential: first.cookie.credential as string },
    );
    expect(second.principal.sessionId).not.toBe(first.principal.sessionId);
    expect((await client.session.findUniqueOrThrow({ where: { id: first.principal.sessionId } })).revokedAt).toEqual(currentTime);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.session-revoked' } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.session-created' } })).toBe(2);
  });

  it('never adopts an attacker-supplied session credential during authentication', async () => {
    const attackerMaterial = new CryptographicSessionCredentialGenerator().generate();
    const established = await service.establish(
      { organizationId: organizationA, employeeId: employeeA, userAccountId: accountA },
      { assurance: { level: 'mfa', methods: ['otp'] }, authenticatedAt: initialNow },
      { status: 'present', credential: attackerMaterial.credential },
    );
    const issuedCredential = established.cookie.credential as string;
    const stored = await client.session.findUniqueOrThrow({
      where: { id: established.principal.sessionId },
    });

    expect(issuedCredential).not.toBe(attackerMaterial.credential);
    expect(stored.credentialHash).not.toBe(attackerMaterial.hash);
    expect((await service.resolveCookie({ status: 'present', credential: attackerMaterial.credential })).principal).toBeNull();
    expect((await service.resolveCookie({ status: 'present', credential: issuedCredential })).principal?.sessionId).toBe(established.principal.sessionId);
  });

  it('keeps self and administration operations organization-scoped and preserves history', async () => {
    const established = await establishA();
    const revoked = await service.revokeSelf(established.principal, established.principal.sessionId);
    expect(revoked).toEqual({ status: 'revoked', currentSessionRevoked: true });
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.session-revoked' } })).toBe(1);

    const secret = new CryptographicSessionCredentialGenerator().generate();
    const bSession = await repository.issue({
      organizationId: organizationB, employeeId: employeeB, userAccountId: accountB,
      credentialHash: secret.hash, issuedAt: initialNow, authenticatedAt: initialNow,
      idleExpiresAt: new Date(initialNow.getTime() + 300_000),
      absoluteExpiresAt: new Date(initialNow.getTime() + 900_000), assuranceLevel: null,
    });
    expect(await repository.revokeAdministration({ actor: established.principal, sessionId: bSession.principal.sessionId, now: currentTime })).toBe('not_found');
    const page = await service.listAdministration(established.principal);
    expect(page.items.every(({ employeeId }) => employeeId === employeeA)).toBe(true);
  });

  it('allows multiple sessions and revoke-all-others preserves the current session explicitly', async () => {
    const current = await establishA();
    currentTime = new Date(initialNow.getTime() + 1_000);
    await establishA();
    const result = await service.revokeAllSelf(current.principal, { includeCurrent: false });
    expect(result).toEqual({ revokedCount: 1, currentSessionRevoked: false });
    const rows = await client.session.findMany({ orderBy: { issuedAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.revokedAt).toBeNull();
    expect(rows[1]?.revokedAt).toEqual(currentTime);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.all-sessions-revoked' } })).toBe(1);
  });

  it('serves the complete self-management lifecycle through the cookie API', async () => {
    const current = await establishA();
    currentTime = new Date(initialNow.getTime() + 1_000);
    const other = await establishA();
    const cookie = `dartech_session=${current.cookie.credential as string}`;

    const listed = await request(app.getHttpServer())
      .get('/api/v1/me/sessions')
      .set('Cookie', cookie)
      .expect(200);
    expect(listed.body.data).toHaveLength(2);
    expect(listed.body.data.find(({ id }: { id: string }) => id === current.principal.sessionId)?.current).toBe(true);

    const revoked = await request(app.getHttpServer())
      .post(`/api/v1/me/sessions/${other.principal.sessionId}/revoke`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({})
      .expect(200);
    expect(revoked.body.data).toEqual({ status: 'revoked', currentSessionRevoked: false });

    const repeated = await request(app.getHttpServer())
      .post(`/api/v1/me/sessions/${other.principal.sessionId}/revoke`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({})
      .expect(200);
    expect(repeated.body.data.status).toBe('idempotent');

    const excludingCurrent = await request(app.getHttpServer())
      .post('/api/v1/me/sessions/revoke-all')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ includeCurrent: false })
      .expect(200);
    expect(excludingCurrent.body.data.currentSessionRevoked).toBe(false);

    const includingCurrent = await request(app.getHttpServer())
      .post('/api/v1/me/sessions/revoke-all')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ includeCurrent: true })
      .expect(200);
    expect(includingCurrent.body.data.currentSessionRevoked).toBe(true);
    expect(includingCurrent.headers['set-cookie']?.[0]).toContain('Max-Age=0');
  });

  it('serves authorized administration only inside the actor organization', async () => {
    const actor = await establishA();
    currentTime = new Date(initialNow.getTime() + 1_000);
    const target = await establishA();
    const secret = new CryptographicSessionCredentialGenerator().generate();
    await repository.issue({
      organizationId: organizationB, employeeId: employeeB, userAccountId: accountB,
      credentialHash: secret.hash, issuedAt: currentTime, authenticatedAt: currentTime,
      idleExpiresAt: new Date(currentTime.getTime() + 300_000),
      absoluteExpiresAt: new Date(currentTime.getTime() + 900_000), assuranceLevel: null,
    });
    const cookie = `dartech_session=${actor.cookie.credential as string}`;

    const listed = await request(app.getHttpServer())
      .get('/api/v1/admin/sessions?page=1&pageSize=100')
      .set('Cookie', cookie)
      .expect(200);
    expect(listed.body.data.total).toBe(2);
    expect(listed.body.data.items.every(({ employeeId }: { employeeId: string }) => employeeId === employeeA)).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/sessions/${target.principal.sessionId}/revoke`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({})
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeB}/sessions/revoke-all`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ includeCurrent: true })
      .expect(404);

    const revokedAll = await request(app.getHttpServer())
      .post(`/api/v1/employees/${employeeA}/sessions/revoke-all`)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ includeCurrent: false })
      .expect(200);
    expect(revokedAll.body.data.currentSessionRevoked).toBe(false);
    expect((await service.resolveCookie({ status: 'present', credential: actor.cookie.credential as string })).principal).not.toBeNull();
    expect(await client.session.count({ where: { organizationId: organizationB, revokedAt: null } })).toBe(1);
  });

  it('serializes concurrent touch and revoke without reviving the revoked credential', async () => {
    const established = await establishA();
    const raw = established.cookie.credential as string;
    currentTime = new Date(initialNow.getTime() + 1_000);
    await Promise.all([
      service.resolveCookie({ status: 'present', credential: raw }),
      service.revokeAllSelf(established.principal, { includeCurrent: true }),
    ]);
    const stored = await client.session.findUniqueOrThrow({ where: { id: established.principal.sessionId } });
    expect(stored.revokedAt).not.toBeNull();
    expect((await service.resolveCookie({ status: 'present', credential: raw })).principal).toBeNull();
  });

  it('serializes two concurrent single revokes to one mutation and one history set', async () => {
    const established = await establishA();
    currentTime = new Date(initialNow.getTime() + 1_000);

    const results = await Promise.all([
      service.revokeSelf(established.principal, established.principal.sessionId),
      service.revokeSelf(established.principal, established.principal.sessionId),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['idempotent', 'revoked']);
    expect(await client.auditEvent.count({ where: { targetId: established.principal.sessionId } })).toBe(2);
    expect(await client.securityEvent.count({ where: { sessionReference: established.principal.sessionId } })).toBe(2);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.session-revoked' } })).toBe(1);
  });

  it('serializes two concurrent revoke-all commands without duplicate command history', async () => {
    const current = await establishA();
    await establishA();
    await establishA();
    currentTime = new Date(initialNow.getTime() + 1_000);

    const results = await Promise.all([
      service.revokeAllSelf(current.principal, { includeCurrent: true }),
      service.revokeAllSelf(current.principal, { includeCurrent: true }),
    ]);

    expect(results.map(({ revokedCount }) => revokedCount).sort((left, right) => left - right)).toEqual([0, 3]);
    expect(await client.session.count({ where: { revokedAt: null } })).toBe(0);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.all-sessions-revoked' } })).toBe(1);
  });

  it('serializes session issuance against revoke-all to a safe post-command session set', async () => {
    const current = await establishA();
    currentTime = new Date(initialNow.getTime() + 1_000);

    const [issued] = await Promise.all([
      establishA(),
      service.revokeAllSelf(current.principal, { includeCurrent: true }),
    ]);

    const rows = await client.session.findMany({ orderBy: { issuedAt: 'asc' } });
    const active = rows.filter(({ revokedAt }) => revokedAt === null);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(active.length).toBeLessThanOrEqual(1);
    if (active.length === 1) expect(active[0]?.id).toBe(issued.principal.sessionId);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.session-created' } })).toBe(2);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.all-sessions-revoked' } })).toBe(1);
  });

  it('does not touch or revive a session when requests arrive exactly at idle expiry', async () => {
    const established = await establishA();
    const raw = established.cookie.credential as string;
    currentTime = established.principal.idleExpiresAt;

    const resolutions = await Promise.all([
      service.resolveCookie({ status: 'present', credential: raw }),
      service.resolveCookie({ status: 'present', credential: raw }),
    ]);
    const stored = await client.session.findUniqueOrThrow({
      where: { id: established.principal.sessionId },
    });

    expect(resolutions.every(({ principal: resolved }) => resolved === null)).toBe(true);
    expect(stored.lastSeenAt).toEqual(initialNow);
    expect(stored.idleExpiresAt).toEqual(established.principal.idleExpiresAt);
    expect(stored.revokedAt).toBeNull();
  });

  it('serializes reauthentication rotation against revoke without duplicate or partial credential state', async () => {
    const original = await establishA();
    const originalCredential = original.cookie.credential as string;
    currentTime = new Date(initialNow.getTime() + 1_000);

    const [rotated] = await Promise.all([
      service.establish(
        { organizationId: organizationA, employeeId: employeeA, userAccountId: accountA },
        { assurance: { level: 'mfa', methods: ['otp'] }, authenticatedAt: currentTime },
        { status: 'present', credential: originalCredential },
      ),
      service.revokeSelf(original.principal, original.principal.sessionId),
    ]);

    const rows = await client.session.findMany({ orderBy: { issuedAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.revokedAt).toEqual(currentTime);
    expect(rows[1]?.id).toBe(rotated.principal.sessionId);
    expect(rows[1]?.revokedAt).toBeNull();
    expect((await service.resolveCookie({ status: 'present', credential: originalCredential })).principal).toBeNull();
    expect((await service.resolveCookie({ status: 'present', credential: rotated.cookie.credential as string })).principal?.sessionId).toBe(rotated.principal.sessionId);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.session-revoked' } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.session-created' } })).toBe(2);
  });

  it('rolls back session persistence, security history, and outbox when mandatory audit fails', async () => {
    const audit: AuditEventAppendPort = { append: () => Promise.reject(new Error('audit unavailable')) };
    const security = app.get<SecurityEventAppendPort>(SECURITY_EVENT_APPEND_PORT);
    const failing = new PrismaSessionRepository(client, audit, security, contextStore);
    const material = new CryptographicSessionCredentialGenerator().generate();
    await expect(failing.issue({
      organizationId: organizationA, employeeId: employeeA, userAccountId: accountA,
      credentialHash: material.hash, issuedAt: initialNow, authenticatedAt: null,
      idleExpiresAt: new Date(initialNow.getTime() + 300_000),
      absoluteExpiresAt: new Date(initialNow.getTime() + 900_000), assuranceLevel: null,
    })).rejects.toThrow('audit unavailable');
    expect(await client.session.count()).toBe(0);
    expect(await client.securityEvent.count()).toBe(0);
    expect(await client.outboxEvent.count()).toBe(0);
    expect(app.get<AuditEventAppendPort>(AUDIT_EVENT_APPEND_PORT)).toBeDefined();
  });

  it('rolls back session persistence and earlier audit history when mandatory security history fails', async () => {
    const audit = app.get<AuditEventAppendPort>(AUDIT_EVENT_APPEND_PORT);
    const security: SecurityEventAppendPort = {
      append: () => Promise.reject(new Error('security unavailable')),
    };
    const failing = new PrismaSessionRepository(client, audit, security, contextStore);
    const material = new CryptographicSessionCredentialGenerator().generate();

    await expect(failing.issue({
      organizationId: organizationA, employeeId: employeeA, userAccountId: accountA,
      credentialHash: material.hash, issuedAt: initialNow, authenticatedAt: null,
      idleExpiresAt: new Date(initialNow.getTime() + 300_000),
      absoluteExpiresAt: new Date(initialNow.getTime() + 900_000), assuranceLevel: null,
    })).rejects.toThrow('security unavailable');
    expect(await client.session.count()).toBe(0);
    expect(await client.auditEvent.count()).toBe(0);
    expect(await client.securityEvent.count()).toBe(0);
    expect(await client.outboxEvent.count()).toBe(0);
  });

  it('rolls issuance back when mandatory outbox persistence fails', async () => {
    await client.$executeRawUnsafe(`
      CREATE FUNCTION t04_reject_session_outbox() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced session outbox failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER t04_reject_session_outbox_trigger
      BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION t04_reject_session_outbox();
    `);
    try {
      await expect(establishA()).rejects.toThrow('forced session outbox failure');
    } finally {
      await client.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS t04_reject_session_outbox_trigger ON outbox_events;
        DROP FUNCTION IF EXISTS t04_reject_session_outbox();
      `);
    }
    expect(await client.session.count()).toBe(0);
    expect(await client.auditEvent.count()).toBe(0);
    expect(await client.securityEvent.count()).toBe(0);
    expect(await client.outboxEvent.count()).toBe(0);
  });

  it('rolls single and revoke-all mutations back when mandatory outbox persistence fails', async () => {
    const current = await establishA();
    const other = await establishA();
    const baseline = {
      audit: await client.auditEvent.count(),
      security: await client.securityEvent.count(),
      outbox: await client.outboxEvent.count(),
    };
    await client.$executeRawUnsafe(`
      CREATE FUNCTION t04_reject_session_outbox() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced session outbox failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER t04_reject_session_outbox_trigger
      BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION t04_reject_session_outbox();
    `);
    try {
      await expect(
        service.revokeSelf(current.principal, other.principal.sessionId),
      ).rejects.toThrow('forced session outbox failure');
      expect((await client.session.findUniqueOrThrow({ where: { id: other.principal.sessionId } })).revokedAt).toBeNull();

      await expect(
        service.revokeAllSelf(current.principal, { includeCurrent: true }),
      ).rejects.toThrow('forced session outbox failure');
    } finally {
      await client.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS t04_reject_session_outbox_trigger ON outbox_events;
        DROP FUNCTION IF EXISTS t04_reject_session_outbox();
      `);
    }
    expect(await client.session.count({ where: { revokedAt: null } })).toBe(2);
    expect(await client.auditEvent.count()).toBe(baseline.audit);
    expect(await client.securityEvent.count()).toBe(baseline.security);
    expect(await client.outboxEvent.count()).toBe(baseline.outbox);
  });
});
