import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_CLOCK,
  AUTHORIZATION_EMERGENCY_ACCESS_PORT,
  AUTHORIZATION_POLICY_EVALUATOR,
  AUTHORIZATION_SCOPE_RESOLVERS,
  AUTHORIZATION_TEMPORARY_ACCESS_PORT,
  type AuthorizationScopeResolver,
} from './authorization.contracts.js';
import {
  DefaultAuthorizationEmergencyAccessAdapter,
  DefaultAuthorizationPolicyEvaluator,
  DefaultAuthorizationTemporaryAccessAdapter,
} from './authorization-extensions.js';
import { AuthorizationModule } from './authorization.module.js';

describe('AuthorizationModule registration boundaries', () => {
  it('accepts a typed production resolver provider outside test environment', () => {
    const dummyResolver: AuthorizationScopeResolver = {
      canResolve: () => false,
      resolve: async () => 'NO_MATCH',
    };

    const dynamicModule = AuthorizationModule.register('production', {
      extensions: {
        scopeResolvers: [dummyResolver],
      },
    });

    expect(dynamicModule).toBeDefined();
    expect(dynamicModule.providers).toBeDefined();

    const resolversProvider = dynamicModule.providers?.find(
      (p) => typeof p === 'object' && 'provide' in p && p.provide === AUTHORIZATION_SCOPE_RESOLVERS,
    );
    expect(resolversProvider).toBeDefined();
    expect((resolversProvider as { useValue: unknown }).useValue).toEqual([dummyResolver]);
  });

  it('rejects test adapters in production when provided via options.testAdapters', () => {
    expect(() =>
      AuthorizationModule.register('production', {
        testAdapters: {
          clock: { now: () => new Date() },
        },
      }),
    ).toThrow('Authorization test adapters are available only in the test environment');
  });

  it('rejects test adapters in development when passed as direct test adapters object', () => {
    expect(() =>
      AuthorizationModule.register('development', {
        clock: { now: () => new Date() },
      }),
    ).toThrow('Authorization test adapters are available only in the test environment');
  });

  it('allows test adapters when APP_ENV=test', () => {
    const mockNow = new Date('2026-09-04T00:00:00.000Z');
    const dynamicModule = AuthorizationModule.register('test', {
      testAdapters: {
        clock: { now: () => mockNow },
      },
    });

    expect(dynamicModule).toBeDefined();
    const clockProvider = dynamicModule.providers?.find(
      (p) => typeof p === 'object' && 'provide' in p && p.provide === AUTHORIZATION_CLOCK,
    );
    expect(clockProvider).toBeDefined();
    expect((clockProvider as { useValue: { now: () => Date } }).useValue.now()).toBe(mockNow);
  });

  it('configures default fail-closed extension ports in production default registration', () => {
    const dynamicModule = AuthorizationModule.register('production');

    expect(dynamicModule).toBeDefined();

    // Verify empty scope resolvers default
    const resolversProvider = dynamicModule.providers?.find(
      (p) => typeof p === 'object' && 'provide' in p && p.provide === AUTHORIZATION_SCOPE_RESOLVERS,
    );
    expect(resolversProvider).toBeDefined();
    expect((resolversProvider as { useValue: unknown }).useValue).toEqual([]);

    // Verify default extension port classes
    const tempAccessProvider = dynamicModule.providers?.find(
      (p) => typeof p === 'object' && 'provide' in p && p.provide === AUTHORIZATION_TEMPORARY_ACCESS_PORT,
    );
    expect(tempAccessProvider).toBeDefined();
    expect((tempAccessProvider as { useClass: unknown }).useClass).toBe(
      DefaultAuthorizationTemporaryAccessAdapter,
    );

    const emergencyAccessProvider = dynamicModule.providers?.find(
      (p) => typeof p === 'object' && 'provide' in p && p.provide === AUTHORIZATION_EMERGENCY_ACCESS_PORT,
    );
    expect(emergencyAccessProvider).toBeDefined();
    expect((emergencyAccessProvider as { useClass: unknown }).useClass).toBe(
      DefaultAuthorizationEmergencyAccessAdapter,
    );

    const policyEvaluatorProvider = dynamicModule.providers?.find(
      (p) => typeof p === 'object' && 'provide' in p && p.provide === AUTHORIZATION_POLICY_EVALUATOR,
    );
    expect(policyEvaluatorProvider).toBeDefined();
    expect((policyEvaluatorProvider as { useClass: unknown }).useClass).toBe(
      DefaultAuthorizationPolicyEvaluator,
    );
  });
});
