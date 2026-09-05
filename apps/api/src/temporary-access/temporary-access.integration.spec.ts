import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { createPrismaClient, type DatabaseClient } from '@dar-tech/database';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from '../app.module.js';
import { AuthorizationActorContext } from '../authorization/authorization-context.js';
import type { AuthorizationActor, AuthorizationResource } from '../authorization/authorization.contracts.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PERMISSION_REGISTRY } from '../permissions/permission-manifest.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import { SessionService } from '../sessions/session.service.js';
import { TemporaryAccessExpiryReconciler } from '../../../worker/src/temporary-access-expiry.reconciler.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const start = new Date('2026-09-06T12:00:00.000Z');
const end = new Date(start.getTime() + 60_000);
const org = randomUUID();
const foreignOrg = randomUUID();
const issuer = randomUUID();
const recipient = randomUUID();
const target = randomUUID();
const tokens = [Buffer.alloc(32, 41).toString('base64url'), Buffer.alloc(32, 42).toString('base64url')];
const read = 'admin.employee.read';
const origin = 'http://localhost:3000';

describe.skipIf(!databaseUrl)('S02-T10 actual PostgreSQL, T04 principal, T07 authorization and T09 approval', () => {
  let client: DatabaseClient;
  let app: INestApplication;
  let now: Date;
  let approvalRequired = false;
  let roleId: string;
  let principal: AuthorizationActor;

  beforeAll(async () => {
    client = createPrismaClient({ databaseUrl: databaseUrl! });
    const contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api', environment: 'test', level: 'error',
      destination: new Writable({ write(_chunk, _encoding, done) { done(); } }),
    });
    const config: ApiConfig = {
      runtime: 'api', appEnvironment: 'test', nodeEnvironment: 'test', logLevel: 'error', port: 3001,
      databaseUrl: databaseUrl!, databasePoolMax: 10, databaseConnectTimeoutMs: 2000, databaseIdleTimeoutMs: 2000,
      authentication: { allowedRedirectUris: [], localProviderEnabled: false, localIdentities: [], transactionTtlSeconds: 300 },
      invitation: { ttlSeconds: 300, rateLimitMaxRequests: 100, rateLimitWindowSeconds: 60 },
      session: { idleTtlSeconds: 1800, absoluteTtlSeconds: 3600, allowedOrigins: [origin], secureCookie: false },
      temporaryAccess: { maxDurationSeconds: 3600 },
    };
    app = await NestFactory.create(AppModule.register(config, { contextStore, logger }, {
      sessionTestAdapters: { clock: { now: () => now } },
      authorizationTestAdapters: {
        clock: { now: () => now },
        approvalPolicyResolver: {
          resolvePolicy: async (input) => approvalRequired && input.action === 'admin.access.temporary'
            ? { policyKey: 'test.temporary', policyVersion: 1, risk: input.risk, outcome: 'SINGLE_APPROVER',
                steps: [{ sequence: 1, approverSubject: { type: 'EMPLOYEE', key: recipient },
                  separationRule: 'REQUESTER_DIFFERENT_EMPLOYEE' }] }
            : { policyKey: 'compatibility.no-approval', policyVersion: 1, risk: input.risk, outcome: 'NO_APPROVAL' },
        },
      },
      approvalApproverTestAdapter: {
        validatePlan: async () => true,
        actorMatches: async ({ actor }) => actor.employeeId === recipient,
      },
    }), { logger });
    configureApiFoundation(app, contextStore, logger, [origin]);
    await app.init();
  });

  async function clear() {
    await client.$executeRawUnsafe(
      'TRUNCATE TABLE "temporary_access_bindings", "temporary_access_grants", "approval_history_entries", "approval_steps", "approval_requests", "audit_events", "security_events", "sessions", "role_permissions", "employee_roles", "permissions", "roles", "invitations", "sso_identities", "user_accounts", "employees", "organizations", "outbox_consumer_receipts", "outbox_events", "queue_jobs"',
    );
  }

  beforeEach(async () => {
    now = new Date(start);
    approvalRequired = false;
    await clear();
    await client.organization.createMany({ data: [
      { id: org, displayName: 'T10 test organization' }, { id: foreignOrg, displayName: 'Other test organization' },
    ] });
    for (const [index, id] of [issuer, recipient, target].entries()) {
      await client.employee.create({ data: {
        id, organizationId: org, employeeCode: 'T10-' + index, firstName: 'Test', lastName: String(index),
        displayName: 'Test Employee ' + index, workEmail: 't10-' + index + '@example.invalid',
        lifecycleStatus: 'ACTIVE', activatedAt: start,
      } });
      const account = await client.userAccount.create({ data: {
        organizationId: org, employeeId: id, authenticationEligible: true, activatedAt: start,
      } });
      if (index < 2) await client.session.create({ data: {
        organizationId: org, employeeId: id, userAccountId: account.id,
        credentialHash: createHash('sha256').update(tokens[index]!).digest('hex'),
        issuedAt: start, lastSeenAt: start, authenticatedAt: start, assuranceLevel: 'mfa',
        idleExpiresAt: new Date(start.getTime() + 1_800_000),
        absoluteExpiresAt: new Date(start.getTime() + 3_600_000),
      } });
    }
    await client.permission.createMany({ data: PERMISSION_REGISTRY.map((permission) => ({ ...permission })) });
    const role = await client.role.create({ data: { organizationId: org, key: 't10-issuer', name: 'Issuer', normalizedName: 'issuer' } });
    roleId = role.id;
    await client.employeeRole.create({ data: {
      organizationId: org, employeeId: issuer, roleId, assignedByEmployeeId: issuer, assignedAt: start, effectiveAt: start,
    } });
    for (const key of ['admin.access.temporary', 'admin.access.revoke', read]) await grant(key);
    const resolved = await app.get(SessionService).requirePrincipal({ status: 'present', credential: tokens[1]! });
    principal = { ...resolved.principal, actorType: 'employee' };
  });

  afterAll(async () => {
    if (client) await clear();
    if (app) await app.close();
    if (client) await client.$disconnect();
  });

  async function grant(key: string, assignedRole = roleId) {
    const permission = await client.permission.findUniqueOrThrow({ where: { key } });
    return client.rolePermission.create({ data: {
      organizationId: org, roleId: assignedRole, permissionId: permission.id, scopeType: 'ORGANIZATION',
      grantedByEmployeeId: issuer, grantedAt: start, effectiveAt: start,
    } });
  }
  function post(path: string, who = 0) {
    return request(app.getHttpServer()).post('/api/v1' + path)
      .set('Cookie', 'dartech_session=' + tokens[who]!).set('Origin', origin);
  }
  function body() {
    return { reason: 'Cover employee directory support', startsAt: start.toISOString(), expiresAt: end.toISOString(),
      bindings: [{ permissionKey: read, scopeType: 'EXPLICIT', resourceType: 'employee', resourceId: target }] };
  }
  async function create(overrides = {}, key = randomUUID()) {
    const result = await post('/employees/' + recipient + '/temporary-access')
      .set('Idempotency-Key', key).send({ ...body(), ...overrides });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body.data as { id: string; status: string; approvalReference: string | null };
  }
  function authorize(resource: AuthorizationResource = { type: 'employee', organizationId: org, id: target }) {
    return app.get(AuthorizationActorContext).run(principal, () =>
      app.get(AuthorizationService).authorize(principal, read, resource, { at: now, source: 'test' }));
  }

  it('denies before start, allows during the interval centrally, denies exactly at and after expiry without a worker', async () => {
    const result = await create({ startsAt: new Date(start.getTime() + 1000).toISOString() });
    expect((await authorize()).allowed).toBe(false);
    now = new Date(start.getTime() + 1000);
    expect((await authorize()).allowed).toBe(true);
    now = new Date(end.getTime() - 1);
    expect((await authorize()).allowed).toBe(true);
    now = new Date(end);
    expect((await authorize()).allowed).toBe(false);
    now = new Date(end.getTime() + 1);
    expect((await authorize()).allowed).toBe(false);
    expect((await client.temporaryAccessGrant.findUniqueOrThrow({ where: { id: result.id } })).status).toBe('GRANTED');
    expect(await client.rolePermission.count({ where: { role: { assignments: { some: { employeeId: recipient } } } } })).toBe(0);
  });

  it('denies wrong organization, exact resource and resource type', async () => {
    await create();
    expect((await authorize({ type: 'employee', organizationId: foreignOrg, id: target })).allowed).toBe(false);
    expect((await authorize({ type: 'employee', organizationId: org, id: issuer })).allowed).toBe(false);
    expect((await authorize({ type: 'role', organizationId: org, id: target })).allowed).toBe(false);
  });

  it.each(['inactive', 'disabled', 'removed-permission', 'revoked-session'] as const)('denies %s with a previously trusted principal', async (state) => {
    await create();
    expect((await authorize()).allowed).toBe(true);
    if (state === 'inactive') await client.employee.update({ where: { id: recipient }, data: { lifecycleStatus: 'SUSPENDED', suspendedAt: now } });
    if (state === 'disabled') await client.userAccount.update({ where: { id: principal.userAccountId }, data: { authenticationEligible: false, disabledAt: now } });
    if (state === 'removed-permission') await client.permission.update({ where: { key: read }, data: { active: false } });
    if (state === 'revoked-session') await client.session.update({ where: { id: principal.sessionId }, data: { revokedAt: now, safeRevocationReason: 'Test administrative revocation' } });
    expect((await authorize()).allowed).toBe(false);
  });

  it('revokes immediately and idempotently with one audit and event', async () => {
    const result = await create();
    const path = '/temporary-access/' + result.id + '/revoke';
    expect((await post(path)).body.data.outcome).toBe('revoked');
    expect((await authorize()).allowed).toBe(false);
    expect((await post(path)).body.data.outcome).toBe('idempotent');
    expect(await client.auditEvent.count({ where: { targetId: result.id, actionKey: 'admin.access.revoke' } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.temporary-access-revoked' } })).toBe(1);
  });

  it('serializes simultaneous revocations and expiry reconciliation without duplicate terminal evidence', async () => {
    const result = await create();
    now = new Date(end);
    const worker = new TemporaryAccessExpiryReconciler(client);
    const [response] = await Promise.all([
      post('/temporary-access/' + result.id + '/revoke'),
      worker.reconcile(now), worker.reconcile(now),
    ]);
    expect(response.status).toBe(200);
    expect((await authorize()).allowed).toBe(false);
    expect(await worker.reconcile(now)).toBe(0);
    expect((await client.temporaryAccessGrant.findUniqueOrThrow({ where: { id: result.id } })).status).toBe('EXPIRED');
    expect(await client.auditEvent.count({ where: { targetId: result.id, actionKey: 'system.access.temporary.expire' } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.temporary-access-expired' } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.temporary-access-revoked' } })).toBe(0);
  });

  it('keeps revocation terminal when two revocations precede later expiry reconciliation', async () => {
    const result = await create();
    const path = '/temporary-access/' + result.id + '/revoke';
    const responses = await Promise.all([post(path), post(path)]);
    expect(responses.map((response) => response.body.data.outcome).sort()).toEqual(['idempotent', 'revoked']);
    now = new Date(end);
    expect(await new TemporaryAccessExpiryReconciler(client).reconcile(now)).toBe(0);
    expect((await authorize()).allowed).toBe(false);
    expect((await client.temporaryAccessGrant.findUniqueOrThrow({ where: { id: result.id } })).status).toBe('REVOKED');
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.temporary-access-revoked' } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.temporary-access-expired' } })).toBe(0);
  });

  it.each(['audit_events', 'outbox_events'] as const)('rolls back grant, bindings, approval and evidence when %s fails', async (table) => {
    approvalRequired = true;
    await client.$executeRawUnsafe(
      "CREATE FUNCTION reject_t10_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'T10 test evidence failure'; END $$",
    );
    await client.$executeRawUnsafe(
      'CREATE TRIGGER reject_t10_evidence BEFORE INSERT ON ' + table + ' FOR EACH ROW EXECUTE FUNCTION reject_t10_evidence()',
    );
    try {
      const response = await post('/employees/' + recipient + '/temporary-access').set('Idempotency-Key', randomUUID()).send(body());
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await client.temporaryAccessGrant.count()).toBe(0);
      expect(await client.temporaryAccessBinding.count()).toBe(0);
      expect(await client.approvalRequest.count()).toBe(0);
      expect(await client.auditEvent.count()).toBe(0);
      expect(await client.outboxEvent.count()).toBe(0);
    } finally {
      await client.$executeRawUnsafe('DROP TRIGGER reject_t10_evidence ON ' + table);
      await client.$executeRawUnsafe('DROP FUNCTION reject_t10_evidence()');
    }
  });

  it('preserves requested/granted bindings and complete audit/outbox evidence', async () => {
    const result = await create();
    const audits = await client.auditEvent.findMany({ where: { targetId: result.id } });
    expect(audits.map((entry) => entry.actionKey).sort()).toEqual(['admin.access.temporary.grant', 'admin.access.temporary.request']);
    expect(audits.every((entry) => (entry.actorSnapshot as { type: string }).type === 'employee')).toBe(true);
    const events = await client.outboxEvent.findMany({ where: { eventType: { startsWith: 'identity.temporary-access-' } } });
    expect(events.map((entry) => entry.eventType).sort()).toEqual(['identity.temporary-access-granted', 'identity.temporary-access-requested']);
    expect(events.every((entry) => entry.eventVersion === 1)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(tokens[0]!);
    expect(await client.temporaryAccessBinding.count({ where: { temporaryAccessGrantId: result.id } })).toBe(1);
    const detail = await request(app.getHttpServer()).get('/api/v1/temporary-access/' + result.id).set('Cookie', 'dartech_session=' + tokens[0]!);
    expect(detail.status).toBe(200);
    expect(detail.body.data.bindings[0].resourceId).toBe(target);
  });

  it('enforces issuer containment and denies missing delegated permission', async () => {
    const permission = await client.permission.findUniqueOrThrow({ where: { key: read } });
    await client.rolePermission.updateMany({ where: { roleId, permissionId: permission.id }, data: {
      scopeType: 'EXPLICIT', scopeBindingType: 'employee', scopeBindingId: target,
    } });
    await create();
    const broad = await post('/employees/' + recipient + '/temporary-access').set('Idempotency-Key', randomUUID()).send({
      ...body(), bindings: [{ permissionKey: read, scopeType: 'ORGANIZATION', resourceType: 'employee' }],
    });
    expect(broad.status).toBe(403);
    await client.rolePermission.updateMany({ where: { roleId, permissionId: permission.id }, data: { removedAt: now, removedByEmployeeId: issuer } });
    const denied = await post('/employees/' + recipient + '/temporary-access').set('Idempotency-Key', randomUUID()).send(body());
    expect(denied.status).toBe(403);
  });

  it('creates one pending request, requires T09 approval, and atomically consumes approval once', async () => {
    approvalRequired = true;
    const key = randomUUID();
    const pending = await create({}, key);
    expect(pending.status).toBe('PENDING_APPROVAL');
    expect((await authorize()).allowed).toBe(false);
    const role = await client.role.create({ data: { organizationId: org, key: 't10-reviewer', name: 'Reviewer', normalizedName: 'reviewer' } });
    await client.employeeRole.create({ data: { organizationId: org, employeeId: recipient, roleId: role.id, assignedByEmployeeId: issuer, assignedAt: start, effectiveAt: start } });
    await grant('approval.request.approve', role.id);
    const approval = await client.approvalRequest.findUniqueOrThrow({ where: { id: pending.approvalReference! }, include: { steps: true } });
    const accepted = await post('/approvals/' + approval.id + '/approve', 1).send({ stepId: approval.steps[0]!.id, expectedVersion: 1 });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const active = await create({ approvalReference: approval.id }, key);
    expect(active.status).toBe('ACTIVE');
    expect((await authorize()).allowed).toBe(true);
    expect((await create({ approvalReference: approval.id }, key)).id).toBe(active.id);
    expect(await client.temporaryAccessGrant.count()).toBe(1);
    expect(await client.approvalRequest.count()).toBe(1);
    expect((await client.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('EXECUTED');
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.temporary-access-granted' } })).toBe(1);
  });

  it('deduplicates concurrent create and rejects silent renewal with the same idempotency key', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([create({}, key), create({}, key)]);
    expect(a.id).toBe(b.id);
    const renewal = await post('/employees/' + recipient + '/temporary-access').set('Idempotency-Key', key)
      .send({ ...body(), expiresAt: new Date(end.getTime() + 1000).toISOString() });
    expect(renewal.status).toBe(409);
    expect((await client.temporaryAccessGrant.findUniqueOrThrow({ where: { id: a.id } })).expiresAt).toEqual(end);
  });

  it.each(['reason', 'startsAt', 'expiresAt'] as const)('requires %s', async (field) => {
    const input: Record<string, unknown> = body();
    delete input[field];
    expect((await post('/employees/' + recipient + '/temporary-access').set('Idempotency-Key', randomUUID()).send(input)).status).toBe(422);
    expect(await client.temporaryAccessGrant.count()).toBe(0);
  });

  it('rejects wildcards and client-authored policy and enforces authentication and CSRF', async () => {
    for (const invalid of [
      { ...body(), bindings: [{ permissionKey: '*', scopeType: 'ORGANIZATION', resourceType: 'employee' }] },
      { ...body(), bindings: [{ permissionKey: read, scopeType: '*', resourceType: 'employee' }] },
      { ...body(), policy: { outcome: 'NO_APPROVAL' } },
      { ...body(), reason: 'x'.repeat(501) },
    ]) expect((await post('/employees/' + recipient + '/temporary-access').set('Idempotency-Key', randomUUID()).send(invalid)).status).toBe(422);
    expect((await request(app.getHttpServer()).get('/api/v1/temporary-access')).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/v1/employees/' + recipient + '/temporary-access')
      .set('Cookie', 'dartech_session=' + tokens[0]!).set('Idempotency-Key', randomUUID()).send(body())).status).toBe(403);
    expect(await client.temporaryAccessGrant.count()).toBe(0);
  });
});
