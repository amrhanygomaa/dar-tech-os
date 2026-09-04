import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_CLOCK,
  AUTHORIZATION_EMERGENCY_GRANT_SOURCE,
  AUTHORIZATION_POLICY_EVALUATOR,
  AUTHORIZATION_SCOPE_RESOLVERS,
  AUTHORIZATION_TEMPORARY_GRANT_SOURCE,
  type AuthorizationEmergencyGrantSource,
  type AuthorizationScopeResolver,
  type AuthorizationTemporaryGrantSource,
} from './authorization.contracts.js';
import {
  DefaultAuthorizationEmergencyGrantSource,
  DefaultAuthorizationPolicyEvaluator,
  DefaultAuthorizationTemporaryGrantSource,
} from './authorization-extensions.js';
import { AuthorizationModule } from './authorization.module.js';

function provider(module: ReturnType<typeof AuthorizationModule.register>, token: symbol) {
  return module.providers?.find(
    (candidate) =>
      typeof candidate === 'object' && 'provide' in candidate && candidate.provide === token,
  ) as { readonly useClass?: unknown; readonly useValue?: unknown } | undefined;
}

describe('AuthorizationModule extension boundaries', () => {
  it('installs fail-closed empty alternate grant sources and the neutral policy by default', () => {
    const module = AuthorizationModule.register('production');
    expect(provider(module, AUTHORIZATION_SCOPE_RESOLVERS)?.useValue).toEqual([]);
    expect(provider(module, AUTHORIZATION_TEMPORARY_GRANT_SOURCE)?.useClass)
      .toBe(DefaultAuthorizationTemporaryGrantSource);
    expect(provider(module, AUTHORIZATION_EMERGENCY_GRANT_SOURCE)?.useClass)
      .toBe(DefaultAuthorizationEmergencyGrantSource);
    expect(provider(module, AUTHORIZATION_POLICY_EVALUATOR)?.useClass)
      .toBe(DefaultAuthorizationPolicyEvaluator);
  });

  it('accepts typed production extension providers without implementing their business behavior', () => {
    const scopeResolver: AuthorizationScopeResolver = {
      canResolve: () => false,
      resolve: async () => 'NO_MATCH',
    };
    const temporaryGrantSource: AuthorizationTemporaryGrantSource = {
      listGrants: async () => [],
    };
    const emergencyGrantSource: AuthorizationEmergencyGrantSource = {
      listGrants: async () => [],
    };
    const module = AuthorizationModule.register('production', {
      extensions: { scopeResolvers: [scopeResolver], temporaryGrantSource, emergencyGrantSource },
    });
    expect(provider(module, AUTHORIZATION_SCOPE_RESOLVERS)?.useValue).toEqual([scopeResolver]);
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
});
