import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ApiConfig } from '@dar-tech/config';
import { createPrismaClient, type DatabaseClient } from '@dar-tech/database';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { PrismaAuthenticationIdentityRepository } from '../auth/prisma-auth-identity.repository.js';
import type { AuthorizationActor } from '../authorization/authorization.contracts.js';
import { PERMISSION_REGISTRY } from '../permissions/permission-manifest.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import { SessionService } from '../sessions/session.service.js';
import { PrismaOffboardingRepository } from './prisma-offboarding.repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const at = new Date('2026-09-07T12:00:00.000Z');
const expiresAt = new Date(at.getTime() + 3_600_000);
const origin = 'http://localhost:3000';
const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const adminId = randomUUID();
const approverId = randomUUID();
const targetId = randomUUID();
const otherId = randomUUID();
const foreignTargetId = randomUUID();
const tokens = [71, 72, 73].map((value) => Buffer.alloc(32, value).toString('base64url'));

function digest(...values: readonly string[]): string {
  return createHash('sha256').update(values.join('\u0000')).digest('hex');
}

describe.skipIf(!databaseUrl)('S02-T13 offboarding with real PostgreSQL', () => {
  let client: DatabaseClient;
  let app: INestApplication;
  let contextStore: RequestContextStore;
  let adminRoleId: string;
  let offboardApprovalEnabled: boolean;
  let suspendApprovalEnabled: boolean;
  let selfTargetAllowed: boolean;
  let policyVersion: number;
  let forceCleanupFailure: boolean;

  beforeAll(async () => {
    client = createPrismaClient({ databaseUrl: databaseUrl! });
    contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'test',
      level: 'error',
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
      sessionTestAdapters: { clock: { now: () => at } },
      authorizationTestAdapters: {
        clock: { now: () => at },
        approvalPolicyResolver: {
          resolvePolicy: async (input) => {
            if (input.action === 'admin.employee.offboard' || input.action === 'admin.employee.suspend') {
              const approvalEnabled = input.action === 'admin.employee.offboard'
                ? offboardApprovalEnabled && (selfTargetAllowed || input.actor.employeeId !== input.resource.id)
                : suspendApprovalEnabled;
              if (!approvalEnabled) {
                return { policyKey: 'compatibility.no-approval', policyVersion, risk: input.risk, outcome: 'NO_APPROVAL' };
              }
              return {
                policyKey: input.action === 'admin.employee.offboard'
                  ? 'test.employee-offboarding'
                  : 'test.employee-suspension',
                policyVersion, risk: input.risk,
                outcome: 'SINGLE_APPROVER',
                steps: [{
                  sequence: 1,
                  approverSubject: { type: 'EMPLOYEE', key: approverId },
                  separationRule: 'REQUESTER_DIFFERENT_EMPLOYEE',
                }],
              };
            }
            return { policyKey: 'compatibility.no-approval', policyVersion: 1, risk: input.risk, outcome: 'NO_APPROVAL' };
          },
        },
      },
      approvalApproverTestAdapter: {
        validatePlan: async () => true,
        actorMatches: async ({ actor }) => actor.employeeId === approverId,
      },
      offboardingTestAdapters: {
        cleanupFailureHook: {
          beforeAccessCleanup: () => {
            if (forceCleanupFailure) {
              forceCleanupFailure = false;
              throw new Error('forced T13 cleanup failure');
            }
          },
        },
      },
    }), { logger });
    configureApiFoundation(app, contextStore, logger, [origin]);
    await app.init();
  });

  async function clear(): Promise<void> {
    await client.$executeRawUnsafe(
      'TRUNCATE TABLE "emergency_access_bindings", "emergency_access_grants", "temporary_access_bindings", "temporary_access_grants", "approval_history_entries", "approval_steps", "approval_requests", "audit_events", "security_events", "sessions", "role_permissions", "employee_roles", "permissions", "roles", "invitations", "sso_identities", "user_accounts", "employees", "organizations", "outbox_consumer_receipts", "outbox_events", "queue_jobs"',
    );
  }

  beforeEach(async () => {
    offboardApprovalEnabled = true;
    suspendApprovalEnabled = false;
    selfTargetAllowed = true;
    policyVersion = 1;
    forceCleanupFailure = false;
    await clear();
    await client.organization.createMany({ data: [
      { id: organizationId, displayName: 'T13 organization' },
      { id: foreignOrganizationId, displayName: 'Foreign organization' },
    ] });
    const employees = [adminId, approverId, targetId, otherId];
    for (const [index, id] of employees.entries()) {
      await client.employee.create({ data: {
        id, organizationId, employeeCode: `T13-${index}`, firstName: 'Lifecycle', lastName: String(index),
        displayName: `Lifecycle Employee ${index}`, workEmail: `t13-${index}@example.invalid`,
        lifecycleStatus: 'ACTIVE', activatedAt: at,
      } });
      const account = await client.userAccount.create({ data: {
        organizationId, employeeId: id, authenticationEligible: true, activatedAt: at,
      } });
      if (index < 3) {
        await client.session.create({ data: {
          organizationId, employeeId: id, userAccountId: account.id,
          credentialHash: digest(tokens[index]!), issuedAt: at, authenticatedAt: at, lastSeenAt: at,
          idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt, assuranceLevel: 'mfa', lastStepUpAt: at,
        } });
      }
      if (id === targetId) {
        await client.sSOIdentity.create({ data: {
          organizationId, userAccountId: account.id, providerKey: 'test-provider', providerSubject: `target-${targetId}`,
          verifiedEmailNormalized: 't13-2@example.invalid', linkedAt: at,
        } });
      }
    }
    await client.employee.create({ data: {
      id: foreignTargetId, organizationId: foreignOrganizationId, employeeCode: 'FOREIGN', firstName: 'Foreign',
      lastName: 'Target', displayName: 'Foreign Target', workEmail: 'foreign@example.invalid', lifecycleStatus: 'ACTIVE', activatedAt: at,
    } });
    await client.userAccount.create({ data: {
      organizationId: foreignOrganizationId, employeeId: foreignTargetId, authenticationEligible: true, activatedAt: at,
    } });
    await client.permission.createMany({ data: PERMISSION_REGISTRY.map((permission) => ({ ...permission })) });
    const adminRole = await client.role.create({ data: {
      organizationId, key: 't13-admin', name: 'T13 administrator', normalizedName: 't13 administrator',
    } });
    adminRoleId = adminRole.id;
    const approverRole = await client.role.create({ data: {
      organizationId, key: 't13-approver', name: 'T13 approver', normalizedName: 't13 approver',
    } });
    await client.employeeRole.createMany({ data: [
      { organizationId, employeeId: adminId, roleId: adminRole.id, assignedByEmployeeId: adminId, assignedAt: at, effectiveAt: at },
      { organizationId, employeeId: approverId, roleId: approverRole.id, assignedByEmployeeId: adminId, assignedAt: at, effectiveAt: at },
    ] });
    for (const key of ['admin.employee.suspend', 'admin.employee.offboard']) await grant(adminRole.id, key);
    for (const key of ['approval.request.read', 'approval.request.approve', 'approval.request.reject']) await grant(approverRole.id, key);
  });

  afterAll(async () => {
    if (client) await clear();
    if (app) await app.close();
    if (client) await client.$disconnect();
  });

  async function grant(roleId: string, permissionKey: string): Promise<void> {
    const permission = await client.permission.findUniqueOrThrow({ where: { key: permissionKey } });
    await client.rolePermission.create({ data: {
      organizationId, roleId, permissionId: permission.id, scopeType: 'ORGANIZATION',
      grantedByEmployeeId: adminId, grantedAt: at, effectiveAt: at,
    } });
  }

  function post(path: string, actor = 0) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Cookie', `dartech_session=${tokens[actor]!}`)
      .set('Origin', origin);
  }

  async function approve(approvalReference: string, reject = false): Promise<void> {
    const approval = await client.approvalRequest.findUniqueOrThrow({
      where: { id: approvalReference }, include: { steps: true },
    });
    const response = await post(`/approvals/${approvalReference}/${reject ? 'reject' : 'approve'}`, 1).send({
      stepId: approval.steps[0]!.id,
      expectedVersion: approval.steps[0]!.version,
      reason: reject ? 'Offboarding rejected' : 'Offboarding approved',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }

  async function requestApproval(reason = 'Employment relationship ended'): Promise<string> {
    const response = await post(`/employees/${targetId}/offboard`).send({ reason });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({ outcome: 'approval_required', securityBarrierActive: false });
    return response.body.data.approvalReference as string;
  }

  async function createAccessFixtures(): Promise<{
    targetAssignmentId: string;
    targetRoleDefinitionId: string;
    targetTemporaryId: string;
    issuerTemporaryId: string;
    targetEmergencyId: string;
    requesterEmergencyId: string;
  }> {
    const targetRole = await client.role.create({ data: {
      organizationId, key: 'target-history', name: 'Target history', normalizedName: 'target history',
    } });
    const targetAssignment = await client.employeeRole.create({ data: {
      organizationId, employeeId: targetId, roleId: targetRole.id, assignedByEmployeeId: adminId,
      assignedAt: at, effectiveAt: at,
    } });
    const temporaryBase = {
      organizationId, issuerSnapshot: { displayName: 'Issuer' }, recipientSnapshot: { displayName: 'Recipient' },
      safeReason: 'Temporary test authority', startsAt: at, expiresAt, status: 'GRANTED' as const,
      requestedAt: at, grantedAt: at, requestFingerprint: digest('request'), contextFingerprint: digest('context'),
    };
    const targetTemporary = await client.temporaryAccessGrant.create({ data: {
      ...temporaryBase, issuerEmployeeId: adminId, recipientEmployeeId: targetId, idempotencyDigest: digest('target-temporary'),
    } });
    const issuerTemporary = await client.temporaryAccessGrant.create({ data: {
      ...temporaryBase, issuerEmployeeId: targetId, recipientEmployeeId: otherId,
      idempotencyDigest: digest('issuer-temporary'), requestFingerprint: digest('issuer-request'),
      contextFingerprint: digest('issuer-context'),
    } });
    const emergencyBase = {
      organizationId, requesterSnapshot: { displayName: 'Requester' }, recipientSnapshot: { displayName: 'Recipient' },
      safeReason: 'Emergency test authority', requestedRisk: 'HIGH' as const, effectiveRisk: 'CRITICAL' as const,
      requestedStartsAt: at, requestedExpiresAt: expiresAt, activatedAt: at, expiresAt, status: 'ACTIVE' as const,
      policyKey: 'test.emergency', policyVersion: 1, policyFingerprint: digest('policy'),
      contextFingerprint: digest('emergency-context'), stepUpAssuranceLevel: 'mfa', stepUpVerifiedAt: at,
      requestFingerprint: digest('emergency-request'),
    };
    const targetEmergency = await client.emergencyAccessGrant.create({ data: {
      ...emergencyBase, requesterEmployeeId: adminId, recipientEmployeeId: targetId,
      idempotencyDigest: digest('target-emergency'),
    } });
    const requesterEmergency = await client.emergencyAccessGrant.create({ data: {
      ...emergencyBase, requesterEmployeeId: targetId, recipientEmployeeId: otherId,
      idempotencyDigest: digest('requester-emergency'), requestFingerprint: digest('requester-emergency-request'),
      contextFingerprint: digest('requester-emergency-context'),
    } });
    return {
      targetAssignmentId: targetAssignment.id,
      targetRoleDefinitionId: targetRole.id,
      targetTemporaryId: targetTemporary.id,
      issuerTemporaryId: issuerTemporary.id,
      targetEmergencyId: targetEmergency.id,
      requesterEmergencyId: requesterEmergency.id,
    };
  }

  it('suspends ACTIVE immediately, revokes sessions, remains idempotent, and denies invalid transitions', async () => {
    expect(PERMISSION_REGISTRY).toHaveLength(31);
    expect((await post(`/employees/${targetId}/archive`)).status).toBe(409);
    const response = await post(`/employees/${targetId}/suspend`).send({ reason: 'Security suspension' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({ outcome: 'changed', securityBarrierActive: true, historyPreserved: true });
    const target = await client.employee.findUniqueOrThrow({ where: { id: targetId }, include: { userAccount: true } });
    expect(target).toMatchObject({ lifecycleStatus: 'SUSPENDED', lifecycleVersion: 2 });
    expect(target.userAccount).toMatchObject({ authenticationEligible: false });
    expect(target.userAccount!.disabledAt).toEqual(at);
    expect(await client.session.count({ where: { employeeId: targetId, revokedAt: null } })).toBe(0);
    await expect(app.get(SessionService).requirePrincipal({ status: 'present', credential: tokens[2]! })).rejects.toMatchObject({ statusCode: 401 });
    expect((await post(`/employees/${targetId}/suspend`).send({ reason: 'Security suspension' })).body.data.outcome).toBe('idempotent');
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-suspended' } })).toBe(1);
    expect((await post(`/employees/${targetId}/archive`)).status).toBe(409);
    const offboardRequest = await post(`/employees/${targetId}/offboard`).send({ reason: 'Employment ended' });
    expect(offboardRequest.status).toBe(200);
    await approve(offboardRequest.body.data.approvalReference as string);
    expect((await post(`/employees/${targetId}/offboard`).send({
      reason: 'Employment ended', approvalReference: offboardRequest.body.data.approvalReference,
    })).status).toBe(200);
    expect((await post(`/employees/${targetId}/suspend`).send({ reason: 'Invalid rollback' })).status).toBe(409);
  });

  it('rejects INVITED lifecycle transitions', async () => {
    await client.session.updateMany({ where: { employeeId: targetId }, data: { revokedAt: at, revokedByEmployeeId: adminId } });
    await client.userAccount.update({ where: { employeeId: targetId }, data: { authenticationEligible: false } });
    await client.employee.update({ where: { id: targetId }, data: { lifecycleStatus: 'INVITED', activatedAt: null } });
    expect((await post(`/employees/${targetId}/suspend`).send({ reason: 'Invalid invitation transition' })).status).toBe(409);
    expect((await post(`/employees/${targetId}/offboard`).send({ reason: 'Invalid invitation transition' })).status).toBe(409);
  });

  it('requires explicit approval, never auto-mutates, and fails closed for rejection, stale context, and NO_APPROVAL', async () => {
    const approvalReference = await requestApproval();
    expect((await client.employee.findUniqueOrThrow({ where: { id: targetId } })).lifecycleStatus).toBe('ACTIVE');
    await approve(approvalReference, true);
    expect((await post(`/employees/${targetId}/offboard`).send({ reason: 'Employment relationship ended', approvalReference })).status).toBe(403);
    expect((await client.employee.findUniqueOrThrow({ where: { id: targetId } })).lifecycleStatus).toBe('ACTIVE');

    const secondReference = await requestApproval('A different approved reason');
    await approve(secondReference);
    expect((await post(`/employees/${targetId}/offboard`).send({ reason: 'Wrong replay reason', approvalReference: secondReference })).status).toBe(403);
    expect((await post(`/employees/${otherId}/offboard`).send({
      reason: 'A different approved reason', approvalReference: secondReference,
    })).status).toBe(403);
    await client.employeeRole.create({ data: {
      organizationId, employeeId: targetId, roleId: adminRoleId, assignedByEmployeeId: adminId,
      assignedAt: at, effectiveAt: at,
    } });
    expect((await post(`/employees/${targetId}/offboard`, 2).send({
      reason: 'A different approved reason', approvalReference: secondReference,
    })).status).toBe(403);
    policyVersion = 2;
    expect((await post(`/employees/${targetId}/offboard`).send({ reason: 'A different approved reason', approvalReference: secondReference })).status).toBe(403);
    policyVersion = 1;
    await client.rolePermission.updateMany({
      where: { roleId: adminRoleId, permission: { key: 'admin.employee.offboard' } },
      data: { removedAt: at, removedByEmployeeId: adminId },
    });
    expect((await post(`/employees/${targetId}/offboard`).send({
      reason: 'A different approved reason', approvalReference: secondReference,
    })).status).toBe(403);
    await grant(adminRoleId, 'admin.employee.offboard');
    offboardApprovalEnabled = false;
    expect((await post(`/employees/${targetId}/offboard`).send({ reason: 'No production policy' })).status).toBe(403);
    expect((await client.employee.findUniqueOrThrow({ where: { id: targetId } })).lifecycleStatus).toBe('ACTIVE');
  });

  it('supports an approval-required suspension policy and denies rejected execution without mutation', async () => {
    suspendApprovalEnabled = true;
    const requested = await post(`/employees/${targetId}/suspend`).send({ reason: 'Approval-controlled suspension' });
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    expect(requested.body.data).toMatchObject({ outcome: 'approval_required', securityBarrierActive: false });
    expect((await client.employee.findUniqueOrThrow({ where: { id: targetId } })).lifecycleStatus).toBe('ACTIVE');
    await approve(requested.body.data.approvalReference as string, true);
    expect((await post(`/employees/${targetId}/suspend`).send({
      reason: 'Approval-controlled suspension', approvalReference: requested.body.data.approvalReference,
    })).status).toBe(403);
    expect((await client.employee.findUniqueOrThrow({ where: { id: targetId } })).lifecycleStatus).toBe('ACTIVE');

    const approved = await post(`/employees/${targetId}/suspend`).send({ reason: 'Approved suspension' });
    const approvalReference = approved.body.data.approvalReference as string;
    await approve(approvalReference);
    expect((await post(`/employees/${targetId}/suspend`).send({
      reason: 'Approved suspension', approvalReference: randomUUID(),
    })).status).toBe(403);
    policyVersion = 2;
    expect((await post(`/employees/${targetId}/suspend`).send({
      reason: 'Approved suspension', approvalReference,
    })).status).toBe(403);
    policyVersion = 1;
    await client.rolePermission.updateMany({
      where: { roleId: adminRoleId, permission: { key: 'admin.employee.suspend' } },
      data: { removedAt: at, removedByEmployeeId: adminId },
    });
    expect((await post(`/employees/${targetId}/suspend`).send({
      reason: 'Approved suspension', approvalReference,
    })).status).toBe(403);
    await grant(adminRoleId, 'admin.employee.suspend');
    const executed = await post(`/employees/${targetId}/suspend`).send({
      reason: 'Approved suspension', approvalReference,
    });
    expect(executed.status, JSON.stringify(executed.body)).toBe(200);
    expect(executed.body.data).toMatchObject({ outcome: 'changed', securityBarrierActive: true });
  });

  it('fails closed for configured-denied self-offboarding and permits the explicitly approved configuration', async () => {
    await client.employeeRole.create({ data: {
      organizationId, employeeId: targetId, roleId: adminRoleId, assignedByEmployeeId: adminId,
      assignedAt: at, effectiveAt: at,
    } });
    selfTargetAllowed = false;
    expect((await post(`/employees/${targetId}/offboard`, 2).send({ reason: 'Denied self-offboarding' })).status).toBe(403);
    expect((await client.employee.findUniqueOrThrow({ where: { id: targetId } })).lifecycleStatus).toBe('ACTIVE');

    selfTargetAllowed = true;
    const requested = await post(`/employees/${targetId}/offboard`, 2).send({ reason: 'Approved self-offboarding' });
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    await approve(requested.body.data.approvalReference as string);
    const executed = await post(`/employees/${targetId}/offboard`, 2).send({
      reason: 'Approved self-offboarding', approvalReference: requested.body.data.approvalReference,
    });
    expect(executed.status, JSON.stringify(executed.body)).toBe(200);
    expect(executed.body.data).toMatchObject({ outcome: 'cleanup_completed', securityBarrierActive: true });
    expect((await client.employee.findUniqueOrThrow({ where: { id: targetId } })).lifecycleStatus).toBe('OFFBOARDING');
  });

  it('keeps the barrier after forced cleanup failure, records incomplete evidence, retries safely, and archives without deleting history', async () => {
    const fixtures = await createAccessFixtures();
    const approvalReference = await requestApproval();
    await approve(approvalReference);
    forceCleanupFailure = true;
    const execution = await post(`/employees/${targetId}/offboard`).send({
      reason: 'Employment relationship ended', approvalReference,
    });
    expect(execution.status, JSON.stringify(execution.body)).toBe(200);
    expect(execution.body.data.outcome).toBe('cleanup_incomplete');
    let target = await client.employee.findUniqueOrThrow({ where: { id: targetId }, include: { userAccount: true } });
    expect(target).toMatchObject({ lifecycleStatus: 'OFFBOARDING', offboardingCleanupStatus: 'INCOMPLETE' });
    expect(target.userAccount).toMatchObject({ authenticationEligible: false });
    await expect(app.get(SessionService).requirePrincipal({ status: 'present', credential: tokens[2]! })).rejects.toMatchObject({ statusCode: 401 });
    const linked = await new PrismaAuthenticationIdentityRepository(client).findLinkedIdentity('test-provider', `target-${targetId}`);
    expect(linked).toMatchObject({ userAccount: { authenticationEligible: false }, employee: { lifecycleStatus: 'OFFBOARDING' } });
    expect(await client.securityEvent.count({ where: { category: 'employee_offboarding_cleanup_incomplete', outcome: 'failed' } })).toBe(1);
    expect((await post(`/employees/${targetId}/archive`)).status).toBe(409);

    const retry = await post(`/employees/${targetId}/offboard`).send({
      reason: 'Employment relationship ended', approvalReference,
    });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.data.outcome).toBe('cleanup_completed');
    expect(await client.employeeRole.findUniqueOrThrow({ where: { id: fixtures.targetAssignmentId } })).toMatchObject({
      removedByEmployeeId: adminId, safeRemovalReason: 'employee_offboarding',
    });
    expect((await client.temporaryAccessGrant.findUniqueOrThrow({ where: { id: fixtures.targetTemporaryId } })).status).toBe('REVOKED');
    expect((await client.temporaryAccessGrant.findUniqueOrThrow({ where: { id: fixtures.issuerTemporaryId } })).status).toBe('GRANTED');
    expect((await client.emergencyAccessGrant.findUniqueOrThrow({ where: { id: fixtures.targetEmergencyId } })).status).toBe('REVOKED');
    expect((await client.emergencyAccessGrant.findUniqueOrThrow({ where: { id: fixtures.requesterEmergencyId } })).status).toBe('ACTIVE');
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-offboarding-started' } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-access-revoked' } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-offboarded' } })).toBe(1);
    expect((await post(`/employees/${targetId}/offboard`).send({
      reason: 'Employment relationship ended', approvalReference,
    })).body.data.outcome).toBe('idempotent');

    const archived = await post(`/employees/${targetId}/archive`);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(archived.body.data.employee.lifecycleStatus).toBe('ARCHIVED');
    expect((await post(`/employees/${targetId}/archive`)).body.data.outcome).toBe('idempotent');
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-archived' } })).toBe(1);
    expect((await post(`/employees/${targetId}/suspend`).send({ reason: 'No archived suspension' })).status).toBe(409);
    expect((await post(`/employees/${targetId}/offboard`).send({ reason: 'No archived offboarding' })).status).toBe(409);
    target = await client.employee.findUniqueOrThrow({ where: { id: targetId }, include: { userAccount: { include: { ssoIdentities: true } } } });
    expect(target.userAccount?.ssoIdentities).toHaveLength(1);
    expect(await client.auditEvent.count({ where: { OR: [{ actorEmployeeId: targetId }, { targetId }] } })).toBeGreaterThan(0);
    expect(await client.role.count({ where: { id: fixtures.targetRoleDefinitionId } })).toBe(1);
  });

  it('denies missing authority, same-session authority removal, unsafe HTTP requests, and foreign targets without enumeration', async () => {
    await client.rolePermission.updateMany({
      where: { roleId: adminRoleId, permission: { key: 'admin.employee.suspend' } },
      data: { removedAt: at, removedByEmployeeId: adminId },
    });
    expect((await post(`/employees/${targetId}/suspend`).send({ reason: 'No current permission' })).status).toBe(403);
    await grant(adminRoleId, 'admin.employee.suspend');
    await client.rolePermission.updateMany({
      where: { roleId: adminRoleId, permission: { key: 'admin.employee.suspend' }, removedAt: null },
      data: { scopeType: 'EXPLICIT', scopeBindingType: 'employee', scopeBindingId: otherId },
    });
    expect((await post(`/employees/${targetId}/suspend`).send({ reason: 'Wrong explicit scope' })).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`/api/v1/employees/${targetId}/suspend`).send({ reason: 'No session' })).status).toBe(401);
    expect((await request(app.getHttpServer()).post(`/api/v1/employees/${targetId}/suspend`).set('Cookie', `dartech_session=${tokens[0]!}`).send({ reason: 'No origin' })).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`/api/v1/employees/${targetId}/suspend`)
      .set('Cookie', `dartech_session=${tokens[0]!}`).set('Origin', 'https://foreign.example')
      .send({ reason: 'Foreign origin' })).status).toBe(403);
    expect((await post(`/employees/${foreignTargetId}/offboard`).send({ reason: 'Foreign target' })).status).toBe(404);
    expect((await post(`/employees/${randomUUID()}/offboard`).send({ reason: 'Absent target' })).status).toBe(404);
  });

  it('serializes equivalent offboard execution and archive retries without duplicate meaningful events', async () => {
    const approvalReference = await requestApproval('Concurrent offboarding');
    await approve(approvalReference);
    const execute = () => post(`/employees/${targetId}/offboard`).send({ reason: 'Concurrent offboarding', approvalReference });
    const executions = await Promise.all([execute(), execute()]);
    expect(executions.every((response) => response.status === 200), executions.map((response) => response.body)).toBe(true);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-offboarding-started' } })).toBe(1);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-offboarded' } })).toBe(1);
    const archives = await Promise.all([post(`/employees/${targetId}/archive`), post(`/employees/${targetId}/archive`)]);
    expect(archives.every((response) => response.status === 200), archives.map((response) => response.body)).toBe(true);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-archived' } })).toBe(1);
  });

  it('serializes concurrent suspension and suspend-versus-offboard transitions', async () => {
    const suspensions = await Promise.all([
      post(`/employees/${targetId}/suspend`).send({ reason: 'Concurrent suspension' }),
      post(`/employees/${targetId}/suspend`).send({ reason: 'Concurrent suspension' }),
    ]);
    expect(suspensions.every((response) => response.status === 200), suspensions.map((response) => response.body)).toBe(true);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-suspended' } })).toBe(1);

    const requested = await post(`/employees/${otherId}/offboard`).send({ reason: 'Concurrent transition' });
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    const approvalReference = requested.body.data.approvalReference as string;
    await approve(approvalReference);
    const suspendedBefore = await client.outboxEvent.count({ where: { eventType: 'identity.employee-suspended' } });
    const startedBefore = await client.outboxEvent.count({ where: { eventType: 'identity.employee-offboarding-started' } });
    const transitions = await Promise.all([
      post(`/employees/${otherId}/suspend`).send({ reason: 'Concurrent competing suspension' }),
      post(`/employees/${otherId}/offboard`).send({ reason: 'Concurrent transition', approvalReference }),
    ]);
    expect(
      transitions.every((response) => [200, 403, 409].includes(response.status)),
      JSON.stringify(transitions.map((response) => ({ status: response.status, body: response.body }))),
    ).toBe(true);
    const finalStatus = (await client.employee.findUniqueOrThrow({ where: { id: otherId } })).lifecycleStatus;
    expect(
      ['SUSPENDED', 'OFFBOARDING'],
      JSON.stringify(transitions.map((response) => ({ status: response.status, body: response.body }))),
    ).toContain(finalStatus);
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-suspended' } })).toBe(suspendedBefore + (finalStatus === 'SUSPENDED' ? 1 : 0));
    expect(await client.outboxEvent.count({ where: { eventType: 'identity.employee-offboarding-started' } })).toBe(startedBefore + (finalStatus === 'OFFBOARDING' ? 1 : 0));
  });

  it('rolls back the critical security barrier when its required audit append fails', async () => {
    const adminAccount = await client.userAccount.findUniqueOrThrow({
      where: { employeeId: adminId }, include: { sessions: true },
    });
    const actor: AuthorizationActor = {
      actorType: 'employee',
      sessionId: adminAccount.sessions[0]!.id,
      organizationId,
      employeeId: adminId,
      userAccountId: adminAccount.id,
      clientKind: 'browser',
      assuranceLevel: 'mfa',
      authenticatedAt: at,
      lastStepUpAt: at,
      issuedAt: at,
      lastSeenAt: at,
      idleExpiresAt: expiresAt,
      absoluteExpiresAt: expiresAt,
    };
    const repository = new PrismaOffboardingRepository(
      client,
      { append: async () => { throw new Error('forced audit failure'); } } as never,
      { append: async () => { throw new Error('security append must not be reached'); } } as never,
      contextStore,
    );
    await expect(repository.transaction(async (transaction) => {
      const target = await repository.lockEmployee(organizationId, targetId, transaction);
      if (!target) throw new Error('missing target fixture');
      return repository.suspendBarrier({
        actor, target, reason: 'Audit coupling test', approvalReference: null,
        correlationId: randomUUID(), at,
      }, transaction);
    })).rejects.toThrow('forced audit failure');
    expect(await client.employee.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({
      lifecycleStatus: 'ACTIVE', lifecycleVersion: 1,
    });
    expect(await client.userAccount.findUniqueOrThrow({ where: { employeeId: targetId } })).toMatchObject({
      authenticationEligible: true, disabledAt: null,
    });
    expect(await client.outboxEvent.count()).toBe(0);
  });
});
