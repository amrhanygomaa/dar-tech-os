import { describe, expect, it, vi } from 'vitest';
import type { SessionPrincipal } from '../sessions/session.contracts.js';
import {
  EXTENSION_SCOPE_TYPES,
  type AuthorizationActor,
  type AuthorizationEmergencyAccessPort,
  type AuthorizationGrant,
  type AuthorizationGrantRepository,
  type AuthorizationMetricsPort,
  type AuthorizationPolicyEvaluator,
  type AuthorizationResource,
  type AuthorizationScopeResolver,
  type AuthorizationTemporaryAccessPort,
} from './authorization.contracts.js';
import {
  DefaultAuthorizationEmergencyAccessAdapter,
  DefaultAuthorizationPolicyEvaluator,
  DefaultAuthorizationTemporaryAccessAdapter,
} from './authorization-extensions.js';
import { AuthorizationService } from './authorization.service.js';

const now = new Date('2026-09-03T12:00:00.000Z');
const principal: SessionPrincipal = {
  sessionId: 'session-a',
  organizationId: 'organization-a',
  employeeId: 'employee-a',
  userAccountId: 'account-a',
  clientKind: 'browser',
  assuranceLevel: 'mfa',
  authenticatedAt: now,
  lastStepUpAt: null,
  issuedAt: now,
  lastSeenAt: now,
  idleExpiresAt: new Date(now.getTime() + 60_000),
  absoluteExpiresAt: new Date(now.getTime() + 600_000),
};
const actor: AuthorizationActor = { ...principal, actorType: 'employee' };
const resource: AuthorizationResource = {
  type: 'employee',
  organizationId: actor.organizationId,
  id: 'employee-b',
};
const organizationGrant: AuthorizationGrant = {
  permissionKey: 'admin.employee.read',
  riskClassification: 'LOW',
  scopeType: 'ORGANIZATION',
  scopeBindingType: null,
  scopeBindingId: null,
};

function harness(
  initialGrants: readonly AuthorizationGrant[] = [],
  resolvers: readonly AuthorizationScopeResolver[] = [],
  options?: {
    temporaryAccess?: AuthorizationTemporaryAccessPort;
    emergencyAccess?: AuthorizationEmergencyAccessPort;
    policyEvaluator?: AuthorizationPolicyEvaluator;
  },
) {
  let grants = initialGrants;
  const repository: AuthorizationGrantRepository = {
    listEffectivePermissionGrantsForEmployee: vi.fn(() => Promise.resolve(grants)),
  };
  const metrics: AuthorizationMetricsPort = { record: vi.fn() };
  const service = new AuthorizationService(
    repository,
    resolvers,
    metrics,
    options?.temporaryAccess,
    options?.emergencyAccess,
    options?.policyEvaluator,
  );
  return { service, repository, metrics, setGrants: (next: readonly AuthorizationGrant[]) => { grants = next; } };
}

describe('S02-T07 canonical authorization service', () => {
  it('allows a canonical permission through an organization-scoped effective grant', async () => {
    const test = harness([organizationGrant]);
    await expect(test.service.authorize(actor, organizationGrant.permissionKey, resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: true, reasonCode: 'AUTHORIZED', matchedGrant: { scopeType: 'ORGANIZATION' } });
    expect(test.repository.listEffectivePermissionGrantsForEmployee).toHaveBeenCalledWith(
      actor.organizationId,
      actor.employeeId,
      now,
    );
  });

  it('denies missing identity, malformed/unknown actions, and dependency failures', async () => {
    const test = harness([organizationGrant]);
    await expect(test.service.authorize(null, organizationGrant.permissionKey, resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'AUTHENTICATION_REQUIRED' });
    await expect(test.service.authorize(actor, 'admin.*', resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'PERMISSION_INVALID' });
    await expect(test.service.authorize(actor, 'admin.employee.unknown', resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'PERMISSION_INVALID' });
    vi.mocked(test.repository.listEffectivePermissionGrantsForEmployee).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(test.service.authorize(actor, organizationGrant.permissionKey, resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED' });
  });

  it('enforces the organization boundary before querying grants', async () => {
    const test = harness([organizationGrant]);
    await expect(test.service.authorize(actor, organizationGrant.permissionKey, { ...resource, organizationId: 'organization-b' }, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'ORGANIZATION_MISMATCH' });
    expect(test.repository.listEffectivePermissionGrantsForEmployee).not.toHaveBeenCalled();
  });

  it('implements strict SELF scope for account and session ownership only', async () => {
    const selfGrant: AuthorizationGrant = { ...organizationGrant, permissionKey: 'identity.account.read_self', scopeType: 'SELF' };
    const test = harness([selfGrant]);
    const own = { type: 'user-account' as const, organizationId: actor.organizationId, id: actor.userAccountId, ownerEmployeeId: actor.employeeId, ownerUserAccountId: actor.userAccountId };
    await expect(test.service.authorize(actor, selfGrant.permissionKey, own, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: true });
    await expect(test.service.authorize(actor, selfGrant.permissionKey, { ...own, id: 'account-b' }, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' });
    await expect(test.service.authorize(actor, selfGrant.permissionKey, { ...own, type: 'employee', id: actor.employeeId }, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' });
  });

  it('matches EXPLICIT only on exact resource type and id', async () => {
    const explicit: AuthorizationGrant = { ...organizationGrant, scopeType: 'EXPLICIT', scopeBindingType: 'employee', scopeBindingId: 'employee-b' };
    const test = harness([explicit]);
    await expect(test.service.authorize(actor, explicit.permissionKey, resource, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: true });
    await expect(test.service.authorize(actor, explicit.permissionKey, { ...resource, id: 'employee-c' }, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: false });
    await expect(test.service.authorize(actor, explicit.permissionKey, { ...resource, type: 'role' }, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: false });
  });

  it('unions all effective grants without broadening their scopes', async () => {
    const wrongExplicit: AuthorizationGrant = { ...organizationGrant, scopeType: 'EXPLICIT', scopeBindingType: 'employee', scopeBindingId: 'employee-c' };
    const test = harness([wrongExplicit, organizationGrant]);
    await expect(test.service.authorize(actor, organizationGrant.permissionKey, resource, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: true, matchedGrant: { scopeType: 'ORGANIZATION' } });
    test.setGrants([wrongExplicit]);
    await expect(test.service.authorize(actor, organizationGrant.permissionKey, resource, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: false });
  });

  it('denies missing and throwing extension resolvers and permits a test-only match', async () => {
    const extension: AuthorizationGrant = { ...organizationGrant, scopeType: 'TEAM' };
    await expect(harness([extension]).service.authorize(actor, extension.permissionKey, resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_RESOLVER_UNAVAILABLE' });
    const throwing: AuthorizationScopeResolver = { canResolve: () => true, resolve: () => Promise.reject(new Error('failed')) };
    await expect(harness([extension], [throwing]).service.authorize(actor, extension.permissionKey, resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_RESOLVER_UNAVAILABLE' });
    const throwingCapabilityCheck: AuthorizationScopeResolver = {
      canResolve: () => { throw new Error('failed'); },
      resolve: () => Promise.resolve('MATCH'),
    };
    await expect(harness([extension], [throwingCapabilityCheck]).service.authorize(actor, extension.permissionKey, resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_RESOLVER_UNAVAILABLE' });
    const matching: AuthorizationScopeResolver = { canResolve: (scope) => scope === 'TEAM', resolve: () => Promise.resolve('MATCH') };
    await expect(harness([extension], [matching]).service.authorize(actor, extension.permissionKey, resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: true });
  });

  it('does not infer authority from role names, founder state, or job-title-like values', async () => {
    const test = harness();
    const decorated = { ...actor, roleName: 'Super Admin', founder: true, jobTitle: 'CEO' } as AuthorizationActor;
    await expect(test.service.authorize(decorated, organizationGrant.permissionKey, resource, { at: now, source: 'test' }))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'PERMISSION_NOT_GRANTED' });
  });

  it('records only bounded decision dimensions', async () => {
    const test = harness([organizationGrant]);
    await test.service.authorize(actor, organizationGrant.permissionKey, resource, { at: now, source: 'test' });
    expect(test.metrics.record).toHaveBeenCalledWith({ outcome: 'allowed', reasonCode: 'AUTHORIZED', actionFamily: 'admin.employee', scopeType: 'ORGANIZATION' });
    expect(JSON.stringify(vi.mocked(test.metrics.record).mock.calls)).not.toContain(actor.employeeId);
    expect(JSON.stringify(vi.mocked(test.metrics.record).mock.calls)).not.toContain(resource.id);
  });

  it('denies all extension scopes (TEAM, ASSIGNED, DEPARTMENT, PROJECT, CUSTOMER) in default production configuration', async () => {
    for (const scopeType of EXTENSION_SCOPE_TYPES) {
      const extensionGrant: AuthorizationGrant = {
        ...organizationGrant,
        scopeType,
      };
      const test = harness([extensionGrant], []);
      const decision = await test.service.authorize(
        actor,
        extensionGrant.permissionKey,
        resource,
        { at: now, source: 'test' },
      );
      expect(decision).toMatchObject({
        allowed: false,
        reasonCode: 'SCOPE_RESOLVER_UNAVAILABLE',
      });
    }
  });

  it('proves default temporary-access port contributes no authority', async () => {
    const defaultTempPort = new DefaultAuthorizationTemporaryAccessAdapter();
    const result = await defaultTempPort.evaluate({
      actor,
      action: organizationGrant.permissionKey,
      resource,
      context: { at: now, source: 'test' },
    });
    expect(result).toEqual({ granted: false });

    // In AuthorizationService, with no matching grant, default temporary port cannot grant authority
    const test = harness([], [], { temporaryAccess: defaultTempPort });
    const decision = await test.service.authorize(
      actor,
      organizationGrant.permissionKey,
      resource,
      { at: now, source: 'test' },
    );
    expect(decision).toMatchObject({
      allowed: false,
      reasonCode: 'PERMISSION_NOT_GRANTED',
    });
  });

  it('proves default emergency-access port contributes no authority and provides no bypass', async () => {
    const defaultEmergencyPort = new DefaultAuthorizationEmergencyAccessAdapter();
    const result = await defaultEmergencyPort.evaluate({
      actor,
      action: organizationGrant.permissionKey,
      resource,
      context: { at: now, source: 'test' },
    });
    expect(result).toEqual({ granted: false });

    // Even with founder / super admin identity, emergency port provides no universal bypass
    const founderActor = { ...actor, founder: true } as AuthorizationActor;
    const test = harness([], [], { emergencyAccess: defaultEmergencyPort });
    const decision = await test.service.authorize(
      founderActor,
      organizationGrant.permissionKey,
      resource,
      { at: now, source: 'test' },
    );
    expect(decision).toMatchObject({
      allowed: false,
      reasonCode: 'PERMISSION_NOT_GRANTED',
    });
  });

  it('proves default policy evaluator preserves role-permission authorization without inventing approval/step-up', async () => {
    const defaultPolicy = new DefaultAuthorizationPolicyEvaluator();
    const policyResult = await defaultPolicy.evaluatePolicy({
      actor,
      action: organizationGrant.permissionKey,
      resource,
      context: { at: now, source: 'test' },
      grant: organizationGrant,
    });
    expect(policyResult).toEqual({ allowed: true });

    const test = harness([organizationGrant], [], { policyEvaluator: defaultPolicy });
    const decision = await test.service.authorize(
      actor,
      organizationGrant.permissionKey,
      resource,
      { at: now, source: 'test' },
    );
    expect(decision).toMatchObject({
      allowed: true,
      reasonCode: 'AUTHORIZED',
    });
  });

  it('fails closed when policy evaluator denies or throws', async () => {
    const denyingPolicy: AuthorizationPolicyEvaluator = {
      evaluatePolicy: vi.fn(() =>
        Promise.resolve({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' }),
      ),
    };
    const testDenying = harness([organizationGrant], [], { policyEvaluator: denyingPolicy });
    await expect(
      testDenying.service.authorize(actor, organizationGrant.permissionKey, resource, {
        at: now,
        source: 'test',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: 'SCOPE_NOT_SATISFIED',
    });

    const throwingPolicy: AuthorizationPolicyEvaluator = {
      evaluatePolicy: vi.fn(() => Promise.reject(new Error('Policy evaluation failure'))),
    };
    const testThrowing = harness([organizationGrant], [], { policyEvaluator: throwingPolicy });
    await expect(
      testThrowing.service.authorize(actor, organizationGrant.permissionKey, resource, {
        at: now,
        source: 'test',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED',
    });
  });

  it('fails closed when temporary access or emergency access ports throw', async () => {
    const throwingTemp: AuthorizationTemporaryAccessPort = {
      evaluate: vi.fn(() => Promise.reject(new Error('Temporary access service down'))),
    };
    const testTemp = harness([], [], { temporaryAccess: throwingTemp });
    await expect(
      testTemp.service.authorize(actor, organizationGrant.permissionKey, resource, {
        at: now,
        source: 'test',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED',
    });

    const throwingEmergency: AuthorizationEmergencyAccessPort = {
      evaluate: vi.fn(() => Promise.reject(new Error('Emergency access service down'))),
    };
    const testEmergency = harness([], [], { emergencyAccess: throwingEmergency });
    await expect(
      testEmergency.service.authorize(actor, organizationGrant.permissionKey, resource, {
        at: now,
        source: 'test',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED',
    });
  });

  it('ensures metric adapter exceptions never alter the authorization decision', async () => {
    const repository: AuthorizationGrantRepository = {
      listEffectivePermissionGrantsForEmployee: vi.fn(() => Promise.resolve([organizationGrant])),
    };
    const throwingMetrics: AuthorizationMetricsPort = {
      record: vi.fn(() => {
        throw new Error('Metrics sink failure');
      }),
    };
    const service = new AuthorizationService(repository, [], throwingMetrics);

    const decision = await service.authorize(actor, organizationGrant.permissionKey, resource, {
      at: now,
      source: 'test',
    });
    expect(decision).toMatchObject({
      allowed: true,
      reasonCode: 'AUTHORIZED',
    });
  });
});

