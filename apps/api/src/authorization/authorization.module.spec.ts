import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_CLOCK,
  AUTHORIZATION_EMERGENCY_GRANT_SOURCE,
  AUTHORIZATION_GRANT_REPOSITORY,
  AUTHORIZATION_METRICS_PORT,
  AUTHORIZATION_POLICY_EVALUATOR,
  AUTHORIZATION_RESOLVER_METRICS_PORT,
  AUTHORIZATION_SCOPE_RESOLVER_REGISTRY,
  AUTHORIZATION_SCOPE_RESOLVERS,
  AUTHORIZATION_TEMPORARY_GRANT_SOURCE,
  type AuthorizationEmergencyGrantSource,
  type AuthorizationScopeResolver,
  type AuthorizationScopeResolverRegistryPort,
  type AuthorizationTemporaryGrantSource,
} from './authorization.contracts.js';
import {
  DefaultAuthorizationEmergencyGrantSource,
  DefaultAuthorizationPolicyEvaluator,
  DefaultAuthorizationTemporaryGrantSource,
} from './authorization-extensions.js';
import { AuthorizationModule } from './authorization.module.js';
import { AuthorizationRequestMiddleware } from './authorization-request.middleware.js';
import { AuthorizationScopeResolverFor } from './authorization-scope-resolver.registry.js';

@Injectable()
class FutureRelationshipRepository {
  matches(): boolean {
    return true;
  }
}

@Injectable()
@AuthorizationScopeResolverFor({ scopeType: 'TEAM', resourceType: 'employee' })
class FutureTeamResolver implements AuthorizationScopeResolver {
  constructor(
    @Inject(FutureRelationshipRepository)
    private readonly relationships: FutureRelationshipRepository,
  ) {}

  canResolve(scopeType: string, resourceType: string): boolean {
    return scopeType === 'TEAM' && resourceType === 'employee';
  }

  async resolve(): Promise<'MATCH' | 'NO_MATCH'> {
    return this.relationships.matches() ? 'MATCH' : 'NO_MATCH';
  }
}

@Module({ providers: [FutureRelationshipRepository, FutureTeamResolver] })
class FutureOwningModule {}

function provider(module: ReturnType<typeof AuthorizationModule.register>, token: symbol) {
  return module.providers?.find(
    (candidate) =>
      typeof candidate === 'object' && 'provide' in candidate && candidate.provide === token,
  ) as {
    readonly useClass?: unknown;
    readonly useExisting?: unknown;
    readonly useValue?: unknown;
  } | undefined;
}

describe('AuthorizationModule extension boundaries', () => {
  it('installs fail-closed empty alternate grant sources and the neutral policy by default', () => {
    const module = AuthorizationModule.register('production');
    expect(provider(module, AUTHORIZATION_SCOPE_RESOLVERS)?.useValue).toEqual([]);
    expect(provider(module, AUTHORIZATION_SCOPE_RESOLVER_REGISTRY)?.useExisting).toBeDefined();
    expect(provider(module, AUTHORIZATION_TEMPORARY_GRANT_SOURCE)?.useClass)
      .toBe(DefaultAuthorizationTemporaryGrantSource);
    expect(provider(module, AUTHORIZATION_EMERGENCY_GRANT_SOURCE)?.useClass)
      .toBe(DefaultAuthorizationEmergencyGrantSource);
    expect(provider(module, AUTHORIZATION_POLICY_EVALUATOR)?.useClass)
      .toBe(DefaultAuthorizationPolicyEvaluator);
  });

  it('accepts typed production extension providers without implementing their business behavior', () => {
    const temporaryGrantSource: AuthorizationTemporaryGrantSource = {
      listGrants: async () => [],
    };
    const emergencyGrantSource: AuthorizationEmergencyGrantSource = {
      listGrants: async () => [],
    };
    const module = AuthorizationModule.register('production', {
      extensions: { temporaryGrantSource, emergencyGrantSource },
    });
    expect(provider(module, AUTHORIZATION_SCOPE_RESOLVERS)?.useValue).toEqual([]);
    expect(provider(module, AUTHORIZATION_TEMPORARY_GRANT_SOURCE)?.useValue)
      .toBe(temporaryGrantSource);
    expect(provider(module, AUTHORIZATION_EMERGENCY_GRANT_SOURCE)?.useValue)
      .toBe(emergencyGrantSource);
  });

  it('rejects test adapters outside APP_ENV=test', () => {
    expect(() =>
      AuthorizationModule.register('production', {
        testAdapters: { clock: { now: () => new Date() } },
      }),
    ).toThrow('Authorization test adapters are available only in the test environment');
  });

  it('accepts test-only alternate grant fakes in APP_ENV=test', () => {
    const temporaryGrantSource: AuthorizationTemporaryGrantSource = {
      listGrants: async () => [],
    };
    const module = AuthorizationModule.register('test', {
      testAdapters: { temporaryGrantSource, clock: { now: () => new Date(0) } },
    });
    expect(provider(module, AUTHORIZATION_TEMPORARY_GRANT_SOURCE)?.useValue)
      .toBe(temporaryGrantSource);
    expect(provider(module, AUTHORIZATION_CLOCK)?.useValue).toBeDefined();
  });

  it('discovers a repository-dependent resolver from an ordinary owning module in production configuration', async () => {
    const moduleBuilder = Test.createTestingModule({
      imports: [
        AuthorizationModule.register('production'),
        FutureOwningModule,
      ],
    });
    const module = await moduleBuilder
      .overrideProvider(AUTHORIZATION_GRANT_REPOSITORY)
      .useValue({ listEffectivePermissionGrantsForEmployee: async () => [] })
      .overrideProvider(AUTHORIZATION_METRICS_PORT)
      .useValue({ record: () => undefined })
      .overrideProvider(AUTHORIZATION_RESOLVER_METRICS_PORT)
      .useValue({ recordResolver: () => undefined })
      .overrideProvider(AuthorizationRequestMiddleware)
      .useValue({ use: () => undefined })
      .compile();
    await module.init();
    const registry = module.get<AuthorizationScopeResolverRegistryPort>(
      AUTHORIZATION_SCOPE_RESOLVER_REGISTRY,
    );
    const at = new Date('2026-09-04T12:00:00.000Z');
    await expect(
      registry.resolve({
        organizationId: 'organization-a',
        actor: {
          actorType: 'employee',
          sessionId: 'session-a',
          organizationId: 'organization-a',
          employeeId: 'employee-a',
          userAccountId: 'account-a',
          clientKind: 'browser',
          assuranceLevel: 'mfa',
          authenticatedAt: at,
          lastStepUpAt: null,
          issuedAt: at,
          lastSeenAt: at,
          idleExpiresAt: new Date(at.getTime() + 60_000),
          absoluteExpiresAt: new Date(at.getTime() + 600_000),
        },
        grant: {
          permissionKey: 'admin.employee.read',
          riskClassification: 'LOW',
          scopeType: 'TEAM',
          scopeBindingType: null,
          scopeBindingId: null,
        },
        resource: {
          type: 'employee',
          organizationId: 'organization-a',
          id: 'employee-b',
        },
        context: { at, source: 'test' },
      }),
    ).resolves.toBe('MATCH');
    await module.close();
  });
});
