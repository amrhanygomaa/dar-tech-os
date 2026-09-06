import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ApiConfig } from '@dar-tech/config';
import { createPrismaClient, runInTransaction, type DatabaseClient } from '@dar-tech/database';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmergencyAccessExpiryReconciler } from '../../../worker/src/emergency-access-expiry.reconciler.js';
import { AppModule } from '../app.module.js';
import { AuthorizationActorContext } from '../authorization/authorization-context.js';
import type { AuthorizationActor, AuthorizationResource } from '../authorization/authorization.contracts.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PERMISSION_REGISTRY } from '../permissions/permission-manifest.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import { SessionService } from '../sessions/session.service.js';
import { EmergencyAccessService } from './emergency-access.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const start = new Date('2026-09-06T12:00:00.000Z');
const end = new Date(start.getTime() + 60_000);
const origin = 'http://localhost:3000';
const org = randomUUID();
const foreignOrg = randomUUID();
const requester = randomUUID();
const recipient = randomUUID();
const approver = randomUUID();
const target = randomUUID();
const tokens = [41, 42, 43].map((value) => Buffer.alloc(32, value).toString('base64url'));
const targetAction = 'admin.employee.read';

describe.skipIf(!databaseUrl)('S02-T11 emergency access with real PostgreSQL and central authorization', () => {
  let client: DatabaseClient;
  let app: INestApplication;
  let now: Date;
  let approvalRequired: boolean;
  let policyVersion: number;
  let requesterRoleId: string;
  let recipientPrincipal: AuthorizationActor;

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
      emergencyAccess: { maxDurationSeconds: 3600 },
    };
    app = await NestFactory.create(AppModule.register(config, { contextStore, logger }, {
      sessionTestAdapters: { clock: { now: () => now } },
      authorizationTestAdapters: {
        clock: { now: () => now },
        approvalPolicyResolver: {
          resolvePolicy: async (input) => input.action === 'admin.access.emergency'
            ? {
                policyKey: 'test.emergency', policyVersion, risk: input.risk,
                outcome: approvalRequired ? 'STEP_UP_AND_APPROVAL' : 'STEP_UP_ONLY',
                stepUpRequirement: { assuranceLevel: 'mfa', maximumAgeSeconds: 300 },
                ...(approvalRequired ? { steps: [{ sequence: 1, approverSubject: { type: 'EMPLOYEE', key: approver }, separationRule: 'REQUESTER_DIFFERENT_EMPLOYEE' }] } : {}),
              }
            : { policyKey: 'compatibility.no-approval', policyVersion: 1, risk: input.risk, outcome: 'NO_APPROVAL' },
        },
      },
      approvalApproverTestAdapter: {
        validatePlan: async () => true,
        actorMatches: async ({ actor }) => actor.employeeId === approver,
      },
    }), { logger });
    configureApiFoundation(app, contextStore, logger, [origin]);
    await app.init();
  });

  async function clear() {
    await client.$executeRawUnsafe('TRUNCATE TABLE "emergency_access_bindings", "emergency_access_grants", "temporary_access_bindings", "temporary_access_grants", "approval_history_entries", "approval_steps", "approval_requests", "audit_events", "security_events", "sessions", "role_permissions", "employee_roles", "permissions", "roles", "invitations", "sso_identities", "user_accounts", "employees", "organizations", "outbox_consumer_receipts", "outbox_events", "queue_jobs"');
  }

  beforeEach(async () => {
    now = new Date(start);
    approvalRequired = false;
    policyVersion = 1;
    await clear();
    await client.organization.createMany({ data: [{ id: org, displayName: 'T11 organization' }, { id: foreignOrg, displayName: 'Foreign organization' }] });
    for (const [index, id] of [requester, recipient, approver, target].entries()) {
      await client.employee.create({ data: {
        id, organizationId: org, employeeCode: `T11-${index}`, firstName: 'Emergency', lastName: String(index),
        displayName: `Emergency Employee ${index}`, workEmail: `t11-${index}@example.invalid`, lifecycleStatus: 'ACTIVE', activatedAt: start,
      } });
      const account = await client.userAccount.create({ data: { organizationId: org, employeeId: id, authenticationEligible: true, activatedAt: start } });
      if (index < 3) await client.session.create({ data: {
        organizationId: org, employeeId: id, userAccountId: account.id,
        credentialHash: createHash('sha256').update(tokens[index]!).digest('hex'),
        issuedAt: start, lastSeenAt: start, authenticatedAt: start, assuranceLevel: 'mfa', lastStepUpAt: start,
        idleExpiresAt: new Date(start.getTime() + 1_800_000), absoluteExpiresAt: new Date(start.getTime() + 3_600_000),
      } });
    }
    await client.permission.createMany({ data: PERMISSION_REGISTRY.map((permission) => ({ ...permission })) });
    const requesterRole = await client.role.create({ data: { organizationId: org, key: 't11-requester', name: 'Emergency requester', normalizedName: 'emergency requester' } });
    requesterRoleId = requesterRole.id;
    const approverRole = await client.role.create({ data: { organizationId: org, key: 't11-approver', name: 'Emergency approver', normalizedName: 'emergency approver' } });
    await client.employeeRole.createMany({ data: [
      { organizationId: org, employeeId: requester, roleId: requesterRole.id, assignedByEmployeeId: requester, assignedAt: start, effectiveAt: start },
      { organizationId: org, employeeId: approver, roleId: approverRole.id, assignedByEmployeeId: requester, assignedAt: start, effectiveAt: start },
    ] });
    for (const key of ['admin.access.emergency', 'admin.access.revoke']) await grant(requesterRole.id, key);
    for (const key of ['approval.request.read', 'approval.request.approve', 'approval.request.reject']) await grant(approverRole.id, key);
    recipientPrincipal = await principal(1);
  });

  afterAll(async () => {
    if (client) await clear();
    if (app) await app.close();
    if (client) await client.$disconnect();
  });

  async function grant(roleId: string, key: string) {
    const permission = await client.permission.findUniqueOrThrow({ where: { key } });
    return client.rolePermission.create({ data: { organizationId: org, roleId, permissionId: permission.id, scopeType: 'ORGANIZATION', grantedByEmployeeId: requester, grantedAt: start, effectiveAt: start } });
  }
  async function principal(index: number): Promise<AuthorizationActor> {
    const resolved = await app.get(SessionService).requirePrincipal({ status: 'present', credential: tokens[index]! });
    return { ...resolved.principal, actorType: 'employee' };
  }
  function post(path: string, who = 0) {
    return request(app.getHttpServer()).post(`/api/v1${path}`).set('Cookie', `dartech_session=${tokens[who]!}`).set('Origin', origin);
  }
  function requestBody(overrides: Record<string, unknown> = {}) {
    return {
      recipientEmployeeId: recipient,
      reason: 'Restore the employee directory during an incident',
      risk: 'LOW',
      startsAt: start.toISOString(),
      expiresAt: end.toISOString(),
      bindings: [{ permissionKey: targetAction, scopeType: 'EXPLICIT', resourceType: 'employee', resourceId: target }],
      ...overrides,
    };
  }
  async function create(overrides: Record<string, unknown> = {}, key = randomUUID()) {
    const response = await post('/emergency-access/requests').set('Idempotency-Key', key).send(requestBody(overrides));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.data as { id: string; storedStatus: string; approvalReference: string | null; effectiveRisk: string };
  }
  async function authorize(resource: AuthorizationResource = { type: 'employee', organizationId: org, id: target }) {
    return app.get(AuthorizationActorContext).run(recipientPrincipal, () => app.get(AuthorizationService).authorize(recipientPrincipal, targetAction, resource, { at: now, source: 'test' }));
  }
  async function approve(approvalReference: string) {
    const approval = await client.approvalRequest.findUniqueOrThrow({ where: { id: approvalReference }, include: { steps: true } });
    const response = await post(`/approvals/${approvalReference}/approve`, 2).send({ stepId: approval.steps[0]!.id, expectedVersion: approval.steps[0]!.version, reason: 'Emergency response approved' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }

  it('requires explicit activation, derives CRITICAL effective risk, and authorizes only the exact target with provenance', async () => {
    const grant = await create();
    expect(grant).toMatchObject({ storedStatus: 'ACTIVATION_ELIGIBLE', effectiveRisk: 'CRITICAL', approvalReference: null });
    expect((await authorize()).allowed).toBe(false);
    const activation = await post(`/emergency-access/${grant.id}/activate`);
    expect(activation.status, JSON.stringify(activation.body)).toBe(200);
    expect(activation.body.data.outcome).toBe('activated');
    const decision = await authorize();
    expect(decision).toMatchObject({ allowed: true, matchedGrant: { source: 'EMERGENCY', sourceReference: grant.id, scopeType: 'EXPLICIT' } });
    expect((await authorize({ type: 'employee', organizationId: org, id: requester })).allowed).toBe(false);
    expect((await app.get(AuthorizationActorContext).run(recipientPrincipal, () => app.get(AuthorizationService).authorize(recipientPrincipal, 'admin.employee.update', { type: 'employee', organizationId: org, id: target }, { at: now, source: 'test' }))).allowed).toBe(false);
    expect((await authorize({ type: 'employee', organizationId: foreignOrg, id: target })).reasonCode).toBe('ORGANIZATION_MISMATCH');
  });

  it('requires approval but never auto-activates, then claims and completes T09 in the activation transaction', async () => {
    approvalRequired = true;
    const grant = await create();
    expect(grant.storedStatus).toBe('PENDING_APPROVAL');
    expect(grant.approvalReference).toBeTruthy();
    await approve(grant.approvalReference!);
    expect((await client.emergencyAccessGrant.findUniqueOrThrow({ where: { id: grant.id } })).status).toBe('PENDING_APPROVAL');
    expect((await authorize()).allowed).toBe(false);
    const activation = await post(`/emergency-access/${grant.id}/activate`);
    expect(activation.status, JSON.stringify(activation.body)).toBe(200);
    expect((await client.approvalRequest.findUniqueOrThrow({ where: { id: grant.approvalReference! } })).executionState).toBe('SUCCEEDED');
    expect((await authorize()).allowed).toBe(true);
  });

  it('deduplicates concurrent equivalent requests and binds idempotency to current policy evidence', async () => {
    const key = randomUUID();
    const submit = () => post('/emergency-access/requests').set('Idempotency-Key', key).send(requestBody());
    const [first, second] = await Promise.all([submit(), submit()]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(await client.emergencyAccessGrant.count()).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.emergency-access-requested' } })).toBe(1);
    policyVersion = 2;
    expect((await submit()).status).toBe(409);
  });

  it('activates at most once under duplicate and concurrent commands', async () => {
    const grant = await create();
    const activate = () => post(`/emergency-access/${grant.id}/activate`);
    const [first, second] = await Promise.all([activate(), activate()]);
    expect([first.status, second.status].sort()).toEqual([200, 200]);
    expect([first.body.data.outcome, second.body.data.outcome].sort()).toEqual(['activated', 'idempotent']);
    expect((await activate()).body.data.outcome).toBe('idempotent');
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.emergency-access-activated' } })).toBe(1);
  });

  it('requires current request authority and removes it immediately for the same session', async () => {
    await client.rolePermission.updateMany({ where: { roleId: requesterRoleId, permission: { key: 'admin.access.emergency' } }, data: { removedAt: now, removedByEmployeeId: requester } });
    expect((await post('/emergency-access/requests').set('Idempotency-Key', randomUUID()).send(requestBody())).status).toBe(403);
    const permission = await client.permission.findUniqueOrThrow({ where: { key: 'admin.access.emergency' } });
    await client.rolePermission.create({ data: { organizationId: org, roleId: requesterRoleId, permissionId: permission.id, scopeType: 'ORGANIZATION', grantedByEmployeeId: requester, grantedAt: now, effectiveAt: now } });
    expect((await post('/emergency-access/requests').set('Idempotency-Key', randomUUID()).send(requestBody())).status).toBe(200);
  });

  it('denies stale step-up, accepts the exact freshness boundary, and rejects client-forged evidence', async () => {
    now = new Date(start.getTime() + 300_000);
    expect((await post('/emergency-access/requests').set('Idempotency-Key', randomUUID()).send(requestBody({ startsAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() }))).status).toBe(200);
    now = new Date(start.getTime() + 300_001);
    const stale = await post('/emergency-access/requests').set('Idempotency-Key', randomUUID()).send(requestBody({ startsAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() }));
    expect(stale.status).toBe(403);
    const forged = await post('/emergency-access/requests').set('Idempotency-Key', randomUUID()).send(requestBody({ lastStepUpAt: now.toISOString() }));
    expect(forged.status).toBe(422);
  });

  it('denies activation after policy version or request authority changes and emits denial evidence', async () => {
    approvalRequired = true;
    const changedPolicy = await create();
    await approve(changedPolicy.approvalReference!);
    policyVersion = 2;
    expect((await post(`/emergency-access/${changedPolicy.id}/activate`)).status).toBe(403);
    policyVersion = 1;
    const removedAuthority = await create({}, randomUUID());
    await approve(removedAuthority.approvalReference!);
    await client.rolePermission.updateMany({ where: { roleId: requesterRoleId, permission: { key: 'admin.access.emergency' } }, data: { removedAt: now, removedByEmployeeId: requester } });
    expect((await post(`/emergency-access/${removedAuthority.id}/activate`)).status).toBe(403);
    expect(await client.securityEvent.count({ where: { eventType: 'EmergencyAccessDenied.v1' } })).toBeGreaterThanOrEqual(2);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.emergency-access-denied' } })).toBeGreaterThanOrEqual(2);
  });

  it('denies before start and at/after expiry without worker reconciliation', async () => {
    const grant = await create({ startsAt: new Date(start.getTime() + 1_000).toISOString() });
    expect((await post(`/emergency-access/${grant.id}/activate`)).status).toBe(403);
    now = new Date(start.getTime() + 1_000);
    expect((await post(`/emergency-access/${grant.id}/activate`)).status).toBe(200);
    now = new Date(end);
    expect((await authorize()).allowed).toBe(false);
    expect((await client.emergencyAccessGrant.findUniqueOrThrow({ where: { id: grant.id } })).status).toBe('ACTIVE');
  });

  it('revokes immediately and idempotently and serializes revoke versus expiry', async () => {
    const grant = await create();
    await post(`/emergency-access/${grant.id}/activate`);
    expect((await post(`/emergency-access/${grant.id}/revoke`)).body.data.outcome).toBe('revoked');
    expect((await authorize()).allowed).toBe(false);
    expect((await post(`/emergency-access/${grant.id}/revoke`)).body.data.outcome).toBe('idempotent');
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.emergency-access-revoked' } })).toBe(1);

    const racing = await create({}, randomUUID());
    await post(`/emergency-access/${racing.id}/activate`);
    now = new Date(end);
    const worker = new EmergencyAccessExpiryReconciler(client);
    await Promise.all([post(`/emergency-access/${racing.id}/revoke`), worker.reconcile(now), worker.reconcile(now)]);
    const terminal = await client.emergencyAccessGrant.findUniqueOrThrow({ where: { id: racing.id } });
    expect(['REVOKED', 'EXPIRED']).toContain(terminal.status);
    expect(await client.outboxEvent.count({ where: { OR: [{ eventType: 'identity.emergency-access-revoked' }, { eventType: 'identity.emergency-access-expired' }], payload: { path: ['emergencyAccessGrantId'], equals: racing.id } } })).toBe(1);
  });

  it('denies activation after revocation and after the exact expiry instant', async () => {
    const revoked = await create();
    await post(`/emergency-access/${revoked.id}/revoke`);
    expect((await post(`/emergency-access/${revoked.id}/activate`)).status).toBe(403);
    const expired = await create({}, randomUUID());
    now = new Date(end);
    expect((await post(`/emergency-access/${expired.id}/activate`)).status).toBe(403);
    expect((await authorize()).allowed).toBe(false);
  });

  it('records material use only for the actual emergency match and rolls it back with the owning transaction', async () => {
    const grant = await create();
    await post(`/emergency-access/${grant.id}/activate`);
    const decision = await authorize();
    const resource: AuthorizationResource = { type: 'employee', organizationId: org, id: target };
    const service = app.get(EmergencyAccessService);
    const recorded = await runInTransaction(client, (transaction) => service.recordIfMaterial({ decision, actor: recipientPrincipal, action: targetAction, resource, correlationId: randomUUID(), at: now, transaction }));
    expect(recorded).toBe(true);
    expect(await client.securityEvent.count({ where: { eventType: 'EmergencyAccessUsed.v1' } })).toBe(1);
    const detail = await request(app.getHttpServer()).get(`/api/v1/emergency-access/${grant.id}`).set('Cookie', `dartech_session=${tokens[0]!}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.history).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'EmergencyAccessUsed.v1', action: targetAction, resourceType: 'employee', resourceId: target })]));

    await grantRoleToRecipient(targetAction);
    const normal = await authorize();
    expect(normal.matchedGrant).not.toHaveProperty('source');
    expect(await runInTransaction(client, (transaction) => service.recordIfMaterial({ decision: normal, actor: recipientPrincipal, action: targetAction, resource, correlationId: randomUUID(), at: now, transaction }))).toBe(false);
    expect(await client.securityEvent.count({ where: { eventType: 'EmergencyAccessUsed.v1' } })).toBe(1);
    await expect(runInTransaction(client, async (transaction) => {
      await service.recordIfMaterial({ decision, actor: recipientPrincipal, action: targetAction, resource, correlationId: randomUUID(), at: now, transaction });
      throw new Error('owning mutation failed');
    })).rejects.toThrow('owning mutation failed');
    expect(await client.securityEvent.count({ where: { eventType: 'EmergencyAccessUsed.v1' } })).toBe(1);
  });

  it('does not falsely attribute a T10 temporary grant as emergency use', async () => {
    const permission = await client.permission.findUniqueOrThrow({ where: { key: targetAction } });
    const temp = await client.temporaryAccessGrant.create({ data: {
      organizationId: org, issuerEmployeeId: requester, recipientEmployeeId: recipient,
      issuerSnapshot: { displayName: 'Requester' }, recipientSnapshot: { displayName: 'Recipient' }, safeReason: 'Temporary support',
      startsAt: start, expiresAt: end, status: 'GRANTED', idempotencyDigest: createHash('sha256').update(randomUUID()).digest('hex'),
      requestFingerprint: createHash('sha256').update(randomUUID()).digest('hex'), contextFingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
      requestedAt: start, grantedAt: start,
      bindings: { create: { permissionKey: targetAction, permissionRiskSnapshot: permission.riskClassification, scopeType: 'EXPLICIT', scopeBindingType: 'employee', scopeBindingId: target, resourceType: 'employee', resourceId: target } },
    } });
    const decision = await authorize();
    expect(decision).toMatchObject({ allowed: true, matchedGrant: { source: 'TEMPORARY' } });
    const recorded = await runInTransaction(client, (transaction) => app.get(EmergencyAccessService).recordIfMaterial({ decision, actor: recipientPrincipal, action: targetAction, resource: { type: 'employee', organizationId: org, id: target }, correlationId: randomUUID(), at: now, transaction }));
    expect(recorded).toBe(false);
    expect(await client.securityEvent.count({ where: { eventType: 'EmergencyAccessUsed.v1' } })).toBe(0);
    expect(temp.id).toBeTruthy();
  });

  it.each(['inactive', 'disabled', 'permission', 'session'] as const)('denies immediately when recipient %s validity is removed', async (kind) => {
    const grant = await create();
    await post(`/emergency-access/${grant.id}/activate`);
    expect((await authorize()).allowed).toBe(true);
    if (kind === 'inactive') await client.employee.update({ where: { id: recipient }, data: { lifecycleStatus: 'SUSPENDED', suspendedAt: now } });
    if (kind === 'disabled') await client.userAccount.update({ where: { id: recipientPrincipal.userAccountId }, data: { disabledAt: now, authenticationEligible: false } });
    if (kind === 'permission') await client.permission.update({ where: { key: targetAction }, data: { active: false } });
    if (kind === 'session') await client.session.update({ where: { id: recipientPrincipal.sessionId }, data: { revokedAt: now, safeRevocationReason: 'Security response' } });
    expect((await authorize()).allowed).toBe(false);
  });

  it('enforces authentication and exact-Origin CSRF before touching a session', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/emergency-access')).status).toBe(401);
    const session = await client.session.findUniqueOrThrow({ where: { id: (await principal(0)).sessionId } });
    const missing = await request(app.getHttpServer()).post('/api/v1/emergency-access/requests').set('Cookie', `dartech_session=${tokens[0]!}`).set('Idempotency-Key', randomUUID()).send(requestBody());
    const foreign = await request(app.getHttpServer()).post('/api/v1/emergency-access/requests').set('Cookie', `dartech_session=${tokens[0]!}`).set('Origin', 'https://foreign.example').set('Idempotency-Key', randomUUID()).send(requestBody());
    expect(missing.status).toBe(403);
    expect(foreign.status).toBe(403);
    expect((await client.session.findUniqueOrThrow({ where: { id: session.id } })).lastSeenAt).toEqual(session.lastSeenAt);
  });

  it('emits all six bounded event contracts with audit and high-priority security linkage', async () => {
    const used = await create();
    await post(`/emergency-access/${used.id}/activate`);
    const decision = await authorize();
    await runInTransaction(client, (transaction) => app.get(EmergencyAccessService).recordIfMaterial({ decision, actor: recipientPrincipal, action: targetAction, resource: { type: 'employee', organizationId: org, id: target }, correlationId: randomUUID(), at: now, transaction }));
    await post(`/emergency-access/${used.id}/revoke`);
    const denied = await create({}, randomUUID());
    policyVersion = 2;
    await post(`/emergency-access/${denied.id}/activate`);
    policyVersion = 1;
    const expired = await create({}, randomUUID());
    await post(`/emergency-access/${expired.id}/activate`);
    now = new Date(end);
    await new EmergencyAccessExpiryReconciler(client).reconcile(now);
    const eventTypes = await client.outboxEvent.findMany({ where: { eventType: { startsWith: 'identity.emergency-access-' } }, select: { eventType: true } });
    for (const type of ['requested', 'activated', 'denied', 'used', 'revoked', 'expired']) expect(eventTypes.map((event) => event.eventType)).toContain(`identity.emergency-access-${type}`);
    const security = await client.securityEvent.findMany({ where: { eventType: { startsWith: 'EmergencyAccess' } } });
    expect(security.every((event) => ['HIGH', 'CRITICAL'].includes(event.risk))).toBe(true);
    expect(JSON.stringify(security)).not.toContain(tokens[0]!);
  });

  async function grantRoleToRecipient(key: string) {
    const role = await client.role.create({ data: { organizationId: org, key: `recipient-${randomUUID()}`, name: 'Recipient exact role', normalizedName: `recipient ${randomUUID()}` } });
    await client.employeeRole.create({ data: { organizationId: org, employeeId: recipient, roleId: role.id, assignedByEmployeeId: requester, assignedAt: now, effectiveAt: now } });
    await grant(role.id, key);
  }
});
