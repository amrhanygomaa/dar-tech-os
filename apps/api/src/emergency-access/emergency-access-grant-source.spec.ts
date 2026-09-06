import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '@dar-tech/database';
import type { ApprovalPolicyResolver } from '../approvals/approval.contracts.js';
import { validateApprovalPolicy } from '../approvals/approval-policy.js';
import type { AuthorizationActor, AuthorizationEmergencyGrantSource } from '../authorization/authorization.contracts.js';
import { emergencySafeContext } from './emergency-access-input.js';
import { PrismaAuthorizationEmergencyGrantSource } from './emergency-access-grant-source.js';

const startsAt = new Date('2026-09-06T10:00:00.000Z');
const expiresAt = new Date('2026-09-06T11:00:00.000Z');
const actor: AuthorizationActor = {
  actorType: 'employee',
  sessionId: '10000000-0000-4000-8000-000000000010',
  organizationId: '10000000-0000-4000-8000-000000000001',
  employeeId: '10000000-0000-4000-8000-000000000002',
  userAccountId: '10000000-0000-4000-8000-000000000003',
  clientKind: 'browser', assuranceLevel: 'mfa', authenticatedAt: startsAt,
  lastStepUpAt: startsAt, issuedAt: startsAt, lastSeenAt: startsAt,
  idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt,
};
const binding = { permissionKey: 'admin.employee.read', riskClassification: 'LOW' as const, scopeType: 'ORGANIZATION' as const, resourceType: 'employee' as const, resourceId: null };
const safeContext = emergencySafeContext({ grantId: '10000000-0000-4000-8000-000000000011', recipientEmployeeId: actor.employeeId, reason: 'Restore service', requestedRisk: 'HIGH', effectiveRisk: 'CRITICAL', startsAt, expiresAt, bindings: [binding] });
const rawPolicy = { policyKey: 'security.emergency', policyVersion: 1, outcome: 'STEP_UP_ONLY' as const, risk: 'CRITICAL' as const, stepUpRequirement: { assuranceLevel: 'mfa', maximumAgeSeconds: 300 } };
const policy = validateApprovalPolicy(rawPolicy, 'CRITICAL')!;
const row = {
  id: safeContext.grantId,
  organizationId: actor.organizationId,
  recipientEmployeeId: actor.employeeId,
  safeReason: 'Restore service',
  requestedRisk: 'HIGH' as const,
  effectiveRisk: 'CRITICAL' as const,
  requestedStartsAt: startsAt,
  expiresAt,
  policyKey: policy.policyKey,
  policyVersion: policy.policyVersion,
  policyFingerprint: policy.fingerprint,
  bindings: [{
    id: '10000000-0000-4000-8000-000000000012',
    organizationId: actor.organizationId,
    emergencyAccessGrantId: safeContext.grantId,
    permissionKey: binding.permissionKey,
    permissionRiskSnapshot: 'LOW' as const,
    scopeType: binding.scopeType,
    scopeBindingType: null,
    scopeBindingId: null,
    resourceType: binding.resourceType,
    resourceId: null,
    createdAt: startsAt,
    permission: { active: true, deprecatedAt: null },
  }],
};

function source(resolver: ApprovalPolicyResolver = { resolvePolicy: vi.fn(async () => rawPolicy) }): AuthorizationEmergencyGrantSource {
  const client = {
    emergencyAccessGrant: {
      findMany: vi.fn(async ({ where }: { where: { expiresAt: { gt: Date } } }) => where.expiresAt.gt < expiresAt ? [row] : []),
    },
  } as unknown as DatabaseClient;
  return new PrismaAuthorizationEmergencyGrantSource(client, resolver);
}

describe('PrismaAuthorizationEmergencyGrantSource', () => {
  it('projects only exact active descriptors with internal grant provenance', async () => {
    await expect(source().listGrants({ actor, action: binding.permissionKey, resource: { type: 'employee', organizationId: actor.organizationId }, context: { at: new Date('2026-09-06T10:30:00.000Z'), source: 'test' } })).resolves.toEqual([{
      permissionKey: binding.permissionKey,
      riskClassification: 'LOW',
      scopeType: 'ORGANIZATION',
      scopeBindingType: null,
      scopeBindingId: null,
      sourceReference: row.id,
    }]);
  });

  it('denies exactly at expiry and after a policy version change', async () => {
    await expect(source().listGrants({ actor, action: binding.permissionKey, resource: { type: 'employee', organizationId: actor.organizationId }, context: { at: expiresAt, source: 'test' } })).resolves.toEqual([]);
    const changed: ApprovalPolicyResolver = { resolvePolicy: async () => ({ ...rawPolicy, policyVersion: 2 }) };
    await expect(source(changed).listGrants({ actor, action: binding.permissionKey, resource: { type: 'employee', organizationId: actor.organizationId }, context: { at: new Date('2026-09-06T10:30:00.000Z'), source: 'test' } })).resolves.toEqual([]);
  });
});
