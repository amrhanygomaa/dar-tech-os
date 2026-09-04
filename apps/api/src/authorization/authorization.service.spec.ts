import { describe, expect, it, vi } from 'vitest';
import type { SessionPrincipal } from '../sessions/session.contracts.js';
import type {
  AuthorizationActor,
  AuthorizationEmergencyGrantSource,
  AuthorizationGrant,
  AuthorizationGrantRepository,
  AuthorizationMetricsPort,
  AuthorizationPolicyEvaluator,
  AuthorizationResource,
  AuthorizationScopeResolver,
  AuthorizationScopeResolverRegistryPort,
  AuthorizationTemporaryGrantSource,
} from './authorization.contracts.js';
import { EXTENSION_SCOPE_TYPES } from './authorization.contracts.js';
import { SCOPE_TYPES } from '../permissions/permission.contracts.js';
import {
  DefaultAuthorizationEmergencyGrantSource,
  DefaultAuthorizationTemporaryGrantSource,
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
  options: {
    readonly temporaryGrantSource?: AuthorizationTemporaryGrantSource;
    readonly emergencyGrantSource?: AuthorizationEmergencyGrantSource;
    readonly policyEvaluator?: AuthorizationPolicyEvaluator;
  } = {},
) {
  let grants = initialGrants;
  const repository: AuthorizationGrantRepository = {
    listEffectivePermissionGrantsForEmployee: vi.fn(() => Promise.resolve(grants)),
  };
  const metrics: AuthorizationMetricsPort = { record: vi.fn() };
  const resolverRegistry: AuthorizationScopeResolverRegistryPort = {
    resolve: async (input) => {
      let matching: readonly AuthorizationScopeResolver[];
      try {
        matching = resolvers.filter((resolver) =>
          resolver.canResolve(input.grant.scopeType, input.resource.type),
        );
      } catch {
        return 'ERROR';
      }
      if (matching.length !== 1) return 'UNAVAILABLE';
      try {
        const result = await matching[0]!.resolve(input);
        return result === 'MATCH' || result === 'NO_MATCH' ? result : 'ERROR';
      } catch {
        return 'ERROR';
      }
    },
  };
  const service = new AuthorizationService(
    repository,
    resolverRegistry,
    metrics,
    options.temporaryGrantSource,
    options.emergencyGrantSource,
    options.policyEvaluator,
  );
  return { service, repository, metrics, setGrants: (next: readonly AuthorizationGrant[]) => { grants = next; } };
}

describe('S02-T07 canonical authorization service', () => {
  it('represents exactly the eight approved scope contracts', () => {
    expect(SCOPE_TYPES).toEqual([
      'SELF',
      'ASSIGNED',
      'TEAM',
      'DEPARTMENT',
      'PROJECT',
      'CUSTOMER',
      'ORGANIZATION',
      'EXPLICIT',
    ]);
  });
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
    for (const malformed of [
      { ...explicit, scopeBindingType: null },
      { ...explicit, scopeBindingId: null },
    ]) {
      await expect(
        harness([malformed]).service.authorize(actor, explicit.permissionKey, resource, {
          at: now,
          source: 'test',
        }),
      ).resolves.toMatchObject({ allowed: false });
    }
  });

  it('unions all effective grants without broadening their scopes', async () => {
    const wrongExplicit: AuthorizationGrant = { ...organizationGrant, scopeType: 'EXPLICIT', scopeBindingType: 'employee', scopeBindingId: 'employee-c' };
    const test = harness([wrongExplicit, organizationGrant]);
    await expect(test.service.authorize(actor, organizationGrant.permissionKey, resource, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: true, matchedGrant: { scopeType: 'ORGANIZATION' } });
    test.setGrants([wrongExplicit]);
    await expect(test.service.authorize(actor, organizationGrant.permissionKey, resource, { at: now, source: 'test' })).resolves.toMatchObject({ allowed: false });
  });

  it.each(EXTENSION_SCOPE_TYPES)(
    'enforces the complete typed resolver contract for %s',
    async (scopeType) => {
      const extension: AuthorizationGrant = {
        ...organizationGrant,
        scopeType,
        scopeBindingType: scopeType.toLowerCase(),
        scopeBindingId: 'relationship-1',
      };
      const matching: AuthorizationScopeResolver = {
        canResolve: (candidateScope, resourceType) =>
          candidateScope === scopeType && resourceType === 'employee',
        resolve: async (resolverInput) =>
          resolverInput.grant.scopeBindingType === scopeType.toLowerCase() &&
          resolverInput.grant.scopeBindingId === 'relationship-1' &&
          resolverInput.resource.id === resource.id
            ? 'MATCH'
            : 'NO_MATCH',
      };
      const noMatch: AuthorizationScopeResolver = {
        ...matching,
        resolve: async () => 'NO_MATCH',
      };
      const throwing: AuthorizationScopeResolver = {
        ...matching,
        resolve: async () => { throw new Error('resolver failed'); },
      };

      await expect(
        harness([extension], [matching]).service.authorize(
          actor,
          extension.permissionKey,
          resource,
          { at: now, source: 'test' },
        ),
      ).resolves.toMatchObject({ allowed: true, matchedGrant: { scopeType } });
      await expect(
        harness([extension], [noMatch]).service.authorize(
          actor,
          extension.permissionKey,
          resource,
          { at: now, source: 'test' },
        ),
      ).resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' });
      for (const resolvers of [[], [throwing]] as const) {
        await expect(
          harness([extension], resolvers).service.authorize(
            actor,
            extension.permissionKey,
            resource,
            { at: now, source: 'test' },
          ),
        ).resolves.toMatchObject({
          allowed: false,
          reasonCode: 'SCOPE_RESOLVER_UNAVAILABLE',
        });
      }
      await expect(
        harness([extension], [matching]).service.authorize(
          actor,
          extension.permissionKey,
          { ...resource, type: 'role' },
          { at: now, source: 'test' },
        ),
      ).resolves.toMatchObject({ allowed: false });
      await expect(
        harness(
          [{ ...extension, scopeBindingId: 'relationship-wrong' }],
          [matching],
        ).service.authorize(actor, extension.permissionKey, resource, {
          at: now,
          source: 'test',
        }),
      ).resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' });

      const wrongOrganizationResolver = { ...matching, resolve: vi.fn(matching.resolve) };
      await expect(
        harness([extension], [wrongOrganizationResolver]).service.authorize(
          actor,
          extension.permissionKey,
          { ...resource, organizationId: 'organization-b' },
          { at: now, source: 'test' },
        ),
      ).resolves.toMatchObject({ allowed: false, reasonCode: 'ORGANIZATION_MISMATCH' });
      expect(wrongOrganizationResolver.resolve).not.toHaveBeenCalled();

      const authorityProbe = { ...matching, resolve: vi.fn(matching.resolve) };
      for (const grants of [
        [],
        [{ ...extension, permissionKey: 'admin.role.read' }],
      ] as const) {
        await expect(
          harness(grants, [authorityProbe]).service.authorize(
            actor,
            extension.permissionKey,
            resource,
            { at: now, source: 'test' },
          ),
        ).resolves.toMatchObject({ allowed: false, reasonCode: 'PERMISSION_NOT_GRANTED' });
      }
      expect(authorityProbe.resolve).not.toHaveBeenCalled();
    },
  );

  it('passes resolvers only a bounded trusted projection', async () => {
    let received: unknown;
    const resolver: AuthorizationScopeResolver = {
      canResolve: () => true,
      resolve: async (input) => {
        received = input;
        return 'MATCH';
      },
    };
    const grant: AuthorizationGrant = { ...organizationGrant, scopeType: 'TEAM' };
    const actorWithUntrustedExtras = {
      ...actor,
      request: { headers: { cookie: 'secret' } },
      roleName: 'Founder',
    } as AuthorizationActor;
    const resourceWithUntrustedExtras = {
      ...resource,
      membershipClaim: 'team-a',
    } as AuthorizationResource;
    await harness([grant], [resolver]).service.authorize(
      actorWithUntrustedExtras,
      grant.permissionKey,
      resourceWithUntrustedExtras,
      { at: now, source: 'test', rawBody: { member: true } } as never,
    );
    expect(received).toMatchObject({ organizationId: actor.organizationId });
    expect(JSON.stringify(received)).not.toMatch(/request|headers|cookie|roleName|membershipClaim|rawBody/u);
  });

  it('keeps TEAM and PROJECT grant union bounded to independently matching scopes', async () => {
    const teamGrant: AuthorizationGrant = { ...organizationGrant, scopeType: 'TEAM' };
    const projectGrant: AuthorizationGrant = { ...organizationGrant, scopeType: 'PROJECT' };
    const resolver = (scopeType: 'TEAM' | 'PROJECT', result: 'MATCH' | 'NO_MATCH') => ({
      canResolve: (scope: string) => scope === scopeType,
      resolve: async () => result,
    }) satisfies AuthorizationScopeResolver;
    await expect(
      harness(
        [teamGrant, projectGrant],
        [resolver('TEAM', 'NO_MATCH'), resolver('PROJECT', 'MATCH')],
      ).service.authorize(actor, organizationGrant.permissionKey, resource, {
        at: now,
        source: 'test',
      }),
    ).resolves.toMatchObject({ allowed: true, matchedGrant: { scopeType: 'PROJECT' } });
    await expect(
      harness(
        [teamGrant, projectGrant],
        [resolver('TEAM', 'NO_MATCH'), resolver('PROJECT', 'NO_MATCH')],
      ).service.authorize(actor, organizationGrant.permissionKey, resource, {
        at: now,
        source: 'test',
      }),
    ).resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' });
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

  it('gives the default temporary and emergency grant sources no authority', async () => {
    const input = { actor, action: organizationGrant.permissionKey, resource, context: { at: now, source: 'test' as const } };
    await expect(new DefaultAuthorizationTemporaryGrantSource().listGrants(input)).resolves.toEqual([]);
    await expect(new DefaultAuthorizationEmergencyGrantSource().listGrants(input)).resolves.toEqual([]);
    await expect(harness().service.authorize(actor, input.action, resource, input.context))
      .resolves.toMatchObject({ allowed: false, reasonCode: 'PERMISSION_NOT_GRANTED' });
  });

  it('routes temporary grants through ORGANIZATION, SELF, and exact EXPLICIT scope evaluation', async () => {
    const ownResource: AuthorizationResource = {
      type: 'user-account',
      organizationId: actor.organizationId,
      id: actor.userAccountId,
      ownerEmployeeId: actor.employeeId,
      ownerUserAccountId: actor.userAccountId,
    };
    const cases = [
      { action: 'admin.employee.read', target: resource, grant: organizationGrant },
      {
        action: 'identity.account.read_self',
        target: ownResource,
        grant: { ...organizationGrant, permissionKey: 'identity.account.read_self', scopeType: 'SELF' as const },
      },
      {
        action: 'admin.employee.read',
        target: resource,
        grant: { ...organizationGrant, scopeType: 'EXPLICIT' as const, scopeBindingType: 'employee', scopeBindingId: resource.id! },
      },
    ];
    for (const scenario of cases) {
      const temporaryGrantSource: AuthorizationTemporaryGrantSource = {
        listGrants: vi.fn(async () => [scenario.grant]),
      };
      await expect(
        harness([], [], { temporaryGrantSource }).service.authorize(
          actor,
          scenario.action,
          scenario.target,
          { at: now, source: 'test' },
        ),
      ).resolves.toMatchObject({ allowed: true, matchedGrant: { scopeType: scenario.grant.scopeType } });
    }
  });

  it('routes emergency grants through ORGANIZATION, SELF, and exact EXPLICIT scope evaluation', async () => {
    const ownResource: AuthorizationResource = {
      type: 'user-account',
      organizationId: actor.organizationId,
      id: actor.userAccountId,
      ownerEmployeeId: actor.employeeId,
      ownerUserAccountId: actor.userAccountId,
    };
    const cases = [
      { action: 'admin.employee.read', target: resource, grant: organizationGrant },
      {
        action: 'identity.account.read_self',
        target: ownResource,
        grant: { ...organizationGrant, permissionKey: 'identity.account.read_self', scopeType: 'SELF' as const },
      },
      {
        action: 'admin.employee.read',
        target: resource,
        grant: { ...organizationGrant, scopeType: 'EXPLICIT' as const, scopeBindingType: 'employee', scopeBindingId: resource.id! },
      },
    ];
    for (const scenario of cases) {
      const emergencyGrantSource: AuthorizationEmergencyGrantSource = {
        listGrants: vi.fn(async () => [scenario.grant]),
      };
      await expect(
        harness([], [], { emergencyGrantSource }).service.authorize(
          actor,
          scenario.action,
          scenario.target,
          { at: now, source: 'test' },
        ),
      ).resolves.toMatchObject({ allowed: true, matchedGrant: { scopeType: scenario.grant.scopeType } });
    }
  });

  it('rejects temporary and emergency grants with the wrong permission, risk, or scope binding', async () => {
    const variants: readonly AuthorizationGrant[] = [
      { ...organizationGrant, permissionKey: 'admin.role.read' },
      { ...organizationGrant, riskClassification: 'CRITICAL' },
      { ...organizationGrant, scopeType: 'EXPLICIT', scopeBindingType: 'employee', scopeBindingId: 'employee-c' },
    ];
    for (const candidate of variants) {
      for (const source of ['temporary', 'emergency'] as const) {
        const grantSource = { listGrants: async () => [candidate] };
        const options = source === 'temporary'
          ? { temporaryGrantSource: grantSource }
          : { emergencyGrantSource: grantSource };
        await expect(
          harness([], [], options).service.authorize(
            actor,
            organizationGrant.permissionKey,
            resource,
            { at: now, source: 'test' },
          ),
        ).resolves.toMatchObject({ allowed: false });
      }
    }
  });

  it('cannot bypass organization, canonical permission, or policy through an alternate source', async () => {
    const temporaryGrantSource: AuthorizationTemporaryGrantSource = {
      listGrants: vi.fn(async () => [organizationGrant]),
    };
    const denyingPolicy: AuthorizationPolicyEvaluator = {
      evaluatePolicy: vi.fn(async () => ({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' })),
    };
    await expect(
      harness([], [], { temporaryGrantSource }).service.authorize(
        actor,
        organizationGrant.permissionKey,
        { ...resource, organizationId: 'organization-b' },
        { at: now, source: 'test' },
      ),
    ).resolves.toMatchObject({ allowed: false, reasonCode: 'ORGANIZATION_MISMATCH' });
    expect(temporaryGrantSource.listGrants).not.toHaveBeenCalled();

    await expect(
      harness([], [], { temporaryGrantSource }).service.authorize(
        actor,
        'admin.employee.unknown',
        resource,
        { at: now, source: 'test' },
      ),
    ).resolves.toMatchObject({ allowed: false, reasonCode: 'PERMISSION_INVALID' });

    const emergencyBoundarySource: AuthorizationEmergencyGrantSource = {
      listGrants: vi.fn(async () => [organizationGrant]),
    };
    await expect(
      harness([], [], { emergencyGrantSource: emergencyBoundarySource }).service.authorize(
        actor,
        organizationGrant.permissionKey,
        { ...resource, organizationId: 'organization-b' },
        { at: now, source: 'test' },
      ),
    ).resolves.toMatchObject({ allowed: false, reasonCode: 'ORGANIZATION_MISMATCH' });
    expect(emergencyBoundarySource.listGrants).not.toHaveBeenCalled();
    await expect(
      harness([], [], { emergencyGrantSource: emergencyBoundarySource }).service.authorize(
        actor,
        'admin.employee.unknown',
        resource,
        { at: now, source: 'test' },
      ),
    ).resolves.toMatchObject({ allowed: false, reasonCode: 'PERMISSION_INVALID' });

    await expect(
      harness([], [], { temporaryGrantSource, policyEvaluator: denyingPolicy }).service.authorize(
        actor,
        organizationGrant.permissionKey,
        resource,
        { at: now, source: 'test' },
      ),
    ).resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' });
    expect(denyingPolicy.evaluatePolicy).toHaveBeenCalledWith(expect.objectContaining({ grant: organizationGrant }));

    const emergencyGrantSource: AuthorizationEmergencyGrantSource = {
      listGrants: async () => [organizationGrant],
    };
    await expect(
      harness([], [], { emergencyGrantSource, policyEvaluator: denyingPolicy }).service.authorize(
        actor,
        organizationGrant.permissionKey,
        resource,
        { at: now, source: 'test' },
      ),
    ).resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' });
  });

  it('fails closed when either alternate grant source or the shared policy throws', async () => {
    for (const options of [
      { temporaryGrantSource: { listGrants: async () => { throw new Error('temporary unavailable'); } } },
      { emergencyGrantSource: { listGrants: async () => { throw new Error('emergency unavailable'); } } },
      {
        temporaryGrantSource: { listGrants: async () => [organizationGrant] },
        policyEvaluator: { evaluatePolicy: async () => { throw new Error('policy unavailable'); } },
      },
    ] satisfies Array<{
      temporaryGrantSource?: AuthorizationTemporaryGrantSource;
      emergencyGrantSource?: AuthorizationEmergencyGrantSource;
      policyEvaluator?: AuthorizationPolicyEvaluator;
    }>) {
      await expect(
        harness([], [], options).service.authorize(actor, organizationGrant.permissionKey, resource, {
          at: now,
          source: 'test',
        }),
      ).resolves.toMatchObject({ allowed: false, reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED' });
    }
  });

  it('does not consult alternate sources after a normal grant authorizes', async () => {
    const temporaryGrantSource: AuthorizationTemporaryGrantSource = { listGrants: vi.fn(async () => []) };
    const emergencyGrantSource: AuthorizationEmergencyGrantSource = { listGrants: vi.fn(async () => []) };
    await expect(
      harness([organizationGrant], [], { temporaryGrantSource, emergencyGrantSource }).service.authorize(
        actor,
        organizationGrant.permissionKey,
        resource,
        { at: now, source: 'test' },
      ),
    ).resolves.toMatchObject({ allowed: true });
    expect(temporaryGrantSource.listGrants).not.toHaveBeenCalled();
    expect(emergencyGrantSource.listGrants).not.toHaveBeenCalled();
  });

  it('denies every unresolved extension scope in the default configuration', async () => {
    for (const scopeType of EXTENSION_SCOPE_TYPES) {
      await expect(
        harness([{ ...organizationGrant, scopeType }]).service.authorize(
          actor,
          organizationGrant.permissionKey,
          resource,
          { at: now, source: 'test' },
        ),
      ).resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_RESOLVER_UNAVAILABLE' });
    }
  });

  it('routes normal grants through the same policy evaluator', async () => {
    const policyEvaluator: AuthorizationPolicyEvaluator = {
      evaluatePolicy: vi.fn(async () => ({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' })),
    };
    await expect(
      harness([organizationGrant], [], { policyEvaluator }).service.authorize(
        actor,
        organizationGrant.permissionKey,
        resource,
        { at: now, source: 'test' },
      ),
    ).resolves.toMatchObject({ allowed: false, reasonCode: 'SCOPE_NOT_SATISFIED' });
    expect(policyEvaluator.evaluatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ grant: organizationGrant }),
    );
  });

  it('fails closed when policy evaluation of a normal grant throws', async () => {
    const policyEvaluator: AuthorizationPolicyEvaluator = {
      evaluatePolicy: async () => { throw new Error('policy unavailable'); },
    };
    await expect(
      harness([organizationGrant], [], { policyEvaluator }).service.authorize(
        actor,
        organizationGrant.permissionKey,
        resource,
        { at: now, source: 'test' },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED',
    });
  });

  it('fails closed when a policy adapter returns a malformed result', async () => {
    for (const result of [{ allowed: 'yes' }, null]) {
      const policyEvaluator = {
        evaluatePolicy: async () => result,
      } as unknown as AuthorizationPolicyEvaluator;
      await expect(
        harness([], [], {
          temporaryGrantSource: { listGrants: async () => [organizationGrant] },
          policyEvaluator,
        }).service.authorize(actor, organizationGrant.permissionKey, resource, {
          at: now,
          source: 'test',
        }),
      ).resolves.toMatchObject({
        allowed: false,
        reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED',
      });
    }
  });

  it('keeps authorization decisions independent from metric sink failures', async () => {
    const repository: AuthorizationGrantRepository = {
      listEffectivePermissionGrantsForEmployee: async () => [organizationGrant],
    };
    const metrics: AuthorizationMetricsPort = {
      record: () => { throw new Error('metrics unavailable'); },
    };
    const service = new AuthorizationService(
      repository,
      { resolve: async () => 'UNAVAILABLE' },
      metrics,
    );
    await expect(
      service.authorize(actor, organizationGrant.permissionKey, resource, {
        at: now,
        source: 'test',
      }),
    ).resolves.toMatchObject({ allowed: true, reasonCode: 'AUTHORIZED' });
  });
});
