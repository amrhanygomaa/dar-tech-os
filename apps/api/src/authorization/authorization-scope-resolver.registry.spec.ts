import type { DiscoveryService } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type {
  AuthorizationActor,
  AuthorizationResolverMetricsPort,
  AuthorizationScopeResolver,
  AuthorizationScopeResolverInput,
} from './authorization.contracts.js';
import {
  AuthorizationScopeResolverFor,
  AuthorizationScopeResolverRegistry,
} from './authorization-scope-resolver.registry.js';

const at = new Date('2026-09-04T12:00:00.000Z');
const actor: AuthorizationActor = {
  actorType: 'employee',
  sessionId: 'session-sensitive',
  organizationId: 'organization-a',
  employeeId: 'employee-sensitive',
  userAccountId: 'account-sensitive',
  clientKind: 'browser',
  assuranceLevel: 'mfa',
  authenticatedAt: at,
  lastStepUpAt: null,
  issuedAt: at,
  lastSeenAt: at,
  idleExpiresAt: new Date(at.getTime() + 60_000),
  absoluteExpiresAt: new Date(at.getTime() + 600_000),
};

function input(scopeType: 'ASSIGNED' | 'TEAM' = 'TEAM'): AuthorizationScopeResolverInput {
  return {
    actor,
    organizationId: actor.organizationId,
    grant: {
      permissionKey: 'admin.employee.read',
      riskClassification: 'LOW',
      scopeType,
      scopeBindingType: 'team',
      scopeBindingId: 'opaque-sensitive-binding',
    },
    resource: {
      type: 'employee',
      organizationId: actor.organizationId,
      id: 'resource-sensitive',
    },
    context: { at, source: 'test' },
  };
}

function discovery(
  registrations: readonly { readonly metatype: object; readonly instance: object }[],
): DiscoveryService {
  return { getProviders: () => registrations } as unknown as DiscoveryService;
}

function metrics() {
  return { recordResolver: vi.fn() } satisfies AuthorizationResolverMetricsPort;
}

@AuthorizationScopeResolverFor({ scopeType: 'TEAM', resourceType: 'employee' })
class TeamResolver implements AuthorizationScopeResolver {
  canResolve(scopeType: string, resourceType: string): boolean {
    return scopeType === 'TEAM' && resourceType === 'employee';
  }

  async resolve(): Promise<'MATCH'> {
    return 'MATCH';
  }
}

@AuthorizationScopeResolverFor({ scopeType: 'TEAM', resourceType: 'employee' })
class SecondTeamResolver extends TeamResolver {}

@AuthorizationScopeResolverFor({ scopeType: 'PROJECT', resourceType: 'role' })
class ProjectRoleResolver implements AuthorizationScopeResolver {
  canResolve(scopeType: string, resourceType: string): boolean {
    return scopeType === 'PROJECT' && resourceType === 'role';
  }

  async resolve(): Promise<'NO_MATCH'> {
    return 'NO_MATCH';
  }
}

describe('S02-T08 production scope resolver registry', () => {
  it('discovers an ordinary decorated Nest provider and reports bounded MATCH metrics', async () => {
    const resolver = new TeamResolver();
    const resolverMetrics = metrics();
    const registry = new AuthorizationScopeResolverRegistry(
      discovery([{ metatype: TeamResolver, instance: resolver }]),
      [],
      resolverMetrics,
    );
    registry.onApplicationBootstrap();

    await expect(registry.resolve(input())).resolves.toBe('MATCH');
    expect(resolverMetrics.recordResolver).toHaveBeenCalledWith({
      scopeType: 'TEAM',
      resourceType: 'employee',
      outcome: 'MATCH',
      latencyBucket: expect.stringMatching(/^(?:LT_(?:5|25|100|500)_MS|GTE_500_MS)$/u),
    });
    const serializedMetrics = JSON.stringify(resolverMetrics.recordResolver.mock.calls);
    expect(serializedMetrics).not.toContain(actor.employeeId);
    expect(serializedMetrics).not.toContain(input().resource.id);
    expect(serializedMetrics).not.toContain(input().grant.scopeBindingId);
  });

  it('returns and observes UNAVAILABLE when no owning module is installed', async () => {
    const resolverMetrics = metrics();
    const registry = new AuthorizationScopeResolverRegistry(discovery([]), [], resolverMetrics);
    registry.onApplicationBootstrap();
    await expect(registry.resolve(input('ASSIGNED'))).resolves.toBe('UNAVAILABLE');
    expect(resolverMetrics.recordResolver).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'UNAVAILABLE', scopeType: 'ASSIGNED' }),
    );
  });

  it('rejects duplicate production ownership in either provider order', () => {
    const first = { metatype: TeamResolver, instance: new TeamResolver() };
    const second = { metatype: SecondTeamResolver, instance: new SecondTeamResolver() };
    for (const registrations of [
      [first, second],
      [second, first],
    ]) {
      const registry = new AuthorizationScopeResolverRegistry(
        discovery(registrations),
        [],
        metrics(),
      );
      expect(() => registry.onApplicationBootstrap()).toThrow(
        'Ambiguous authorization scope resolver capability: TEAM/employee',
      );
    }
  });

  it('allows unrelated resolver capabilities to coexist', async () => {
    const registry = new AuthorizationScopeResolverRegistry(
      discovery([
        { metatype: TeamResolver, instance: new TeamResolver() },
        { metatype: ProjectRoleResolver, instance: new ProjectRoleResolver() },
      ]),
      [],
      metrics(),
    );
    registry.onApplicationBootstrap();

    await expect(registry.resolve(input())).resolves.toBe('MATCH');
    await expect(
      registry.resolve({
        ...input(),
        grant: { ...input().grant, scopeType: 'PROJECT' },
        resource: { ...input().resource, type: 'role' },
      }),
    ).resolves.toBe('NO_MATCH');
  });

  it('bounds capability callback failures at startup', () => {
    @AuthorizationScopeResolverFor({ scopeType: 'TEAM', resourceType: 'employee' })
    class ThrowingCapabilityResolver extends TeamResolver {
      override canResolve(): boolean {
        throw new Error('sensitive repository detail');
      }
    }
    const registry = new AuthorizationScopeResolverRegistry(
      discovery([
        {
          metatype: ThrowingCapabilityResolver,
          instance: new ThrowingCapabilityResolver(),
        },
      ]),
      [],
      metrics(),
    );
    expect(() => registry.onApplicationBootstrap()).toThrow(
      'Authorization scope resolver capability contract mismatch',
    );
  });

  it('fails closed and observes ERROR for resolver exceptions and malformed results', async () => {
    for (const resolver of [
      { canResolve: () => true, resolve: async () => { throw new Error('unavailable'); } },
      { canResolve: () => true, resolve: async () => 'ALLOW' },
    ] as readonly AuthorizationScopeResolver[]) {
      const resolverMetrics = metrics();
      const registry = new AuthorizationScopeResolverRegistry(
        discovery([]),
        [resolver],
        resolverMetrics,
      );
      registry.onApplicationBootstrap();
      await expect(registry.resolve(input())).resolves.toBe('ERROR');
      expect(resolverMetrics.recordResolver).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'ERROR' }),
      );
    }
  });

  it('keeps resolver results independent from observability failures', async () => {
    const registry = new AuthorizationScopeResolverRegistry(
      discovery([{ metatype: TeamResolver, instance: new TeamResolver() }]),
      [],
      { recordResolver: () => { throw new Error('metric sink failed'); } },
    );
    registry.onApplicationBootstrap();
    await expect(registry.resolve(input())).resolves.toBe('MATCH');
  });
});
