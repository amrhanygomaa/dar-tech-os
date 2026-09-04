import { describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '@dar-tech/observability';
import type {
  AuthorizationMetricsPort,
  AuthorizationResolverMetricsPort,
} from './authorization.contracts.js';
import {
  StructuredAuthorizationMetricsAdapter,
  StructuredAuthorizationResolverMetricsAdapter,
} from './authorization-metrics.js';

function harness(options?: { readonly windowMs?: number; readonly maxEntries?: number }) {
  let currentTime = 1_000_000;
  const logger = { info: vi.fn() } as unknown as StructuredLogger;
  const adapter = new StructuredAuthorizationMetricsAdapter(logger, {
    windowMs: options?.windowMs ?? 60_000,
    maxEntries: options?.maxEntries ?? 256,
    now: () => currentTime,
  });
  return { adapter, logger, advance: (milliseconds: number) => { currentTime += milliseconds; } };
}

function resolverHarness(options?: {
  readonly windowMs?: number;
  readonly maxEmissionsPerWindow?: number;
}) {
  let currentTime = 1_000_000;
  const logger = { info: vi.fn() } as unknown as StructuredLogger;
  const adapter = new StructuredAuthorizationResolverMetricsAdapter(logger, {
    windowMs: options?.windowMs ?? 60_000,
    maxEmissionsPerWindow: options?.maxEmissionsPerWindow ?? 128,
    now: () => currentTime,
  });
  return {
    adapter,
    logger,
    advance: (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
}

const decision: Parameters<AuthorizationMetricsPort['record']>[0] = {
  outcome: 'allowed',
  reasonCode: 'AUTHORIZED',
  actionFamily: 'admin.employee',
  scopeType: 'ORGANIZATION',
};

const resolverMetric: Parameters<AuthorizationResolverMetricsPort['recordResolver']>[0] = {
  scopeType: 'PROJECT',
  resourceType: 'employee',
  outcome: 'NO_MATCH',
  latencyBucket: 'LT_25_MS',
};

describe('StructuredAuthorizationMetricsAdapter bounded observability', () => {
  it('emits only the bounded dimensions', () => {
    const { adapter, logger } = harness();
    adapter.record({
      ...decision,
      employeeId: 'employee-secret',
      sessionId: 'session-secret',
    } as unknown as typeof decision);
    expect(logger.info).toHaveBeenCalledWith('authorization.decision.metric', decision);
  });

  it('suppresses repeated categories inside the window and emits again after expiry', () => {
    const { adapter, logger, advance } = harness({ windowMs: 100 });
    adapter.record(decision);
    adapter.record(decision);
    expect(logger.info).toHaveBeenCalledTimes(1);
    advance(101);
    adapter.record(decision);
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it('uses bounded expiry/insertion-order eviction', () => {
    const { adapter } = harness({ maxEntries: 2 });
    for (const actionFamily of ['admin.employee', 'admin.role', 'admin.session']) {
      adapter.record({ ...decision, actionFamily });
    }
    const cache = (adapter as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBe(2);
  });

  it('collapses unbounded action families and swallows logger errors', () => {
    const { adapter, logger } = harness();
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('sink failed'); });
    expect(() => adapter.record({ ...decision, actionFamily: 'user-input!*' })).not.toThrow();
    adapter.record({ ...decision, actionFamily: 'second-invalid!*' });
    expect(logger.info).toHaveBeenLastCalledWith(
      'authorization.decision.metric',
      { ...decision, actionFamily: 'invalid' },
    );
  });
});

describe('StructuredAuthorizationResolverMetricsAdapter bounded observability', () => {
  it('emits the first resolver category', () => {
    const { adapter, logger } = resolverHarness();
    adapter.recordResolver(resolverMetric);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('suppresses a repeated resolver category inside the window', () => {
    const { adapter, logger } = resolverHarness();
    adapter.recordResolver(resolverMetric);
    adapter.recordResolver(resolverMetric);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('emits a different bounded resolver category inside the window', () => {
    const { adapter, logger } = resolverHarness();
    adapter.recordResolver(resolverMetric);
    adapter.recordResolver({ ...resolverMetric, outcome: 'MATCH' });
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it('never exceeds the configured global emission limit within a window', () => {
    const { adapter, logger } = resolverHarness({ maxEmissionsPerWindow: 2 });
    adapter.recordResolver(resolverMetric);
    adapter.recordResolver({ ...resolverMetric, outcome: 'MATCH' });
    adapter.recordResolver({ ...resolverMetric, outcome: 'ERROR' });
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it('does not let category churn bypass the global cap', () => {
    const { adapter, logger } = resolverHarness({ maxEmissionsPerWindow: 3 });
    const outcomes = ['MATCH', 'NO_MATCH', 'UNAVAILABLE', 'ERROR'] as const;
    const latencyBuckets = ['LT_5_MS', 'LT_25_MS', 'LT_100_MS', 'LT_500_MS', 'GTE_500_MS'] as const;

    for (const outcome of outcomes) {
      for (const latencyBucket of latencyBuckets) {
        adapter.recordResolver({ ...resolverMetric, outcome, latencyBucket });
      }
    }

    expect(logger.info).toHaveBeenCalledTimes(3);
  });

  it('permits emission again in the next window', () => {
    const { adapter, logger, advance } = resolverHarness({
      windowMs: 100,
      maxEmissionsPerWindow: 1,
    });
    adapter.recordResolver(resolverMetric);
    adapter.recordResolver({ ...resolverMetric, outcome: 'MATCH' });
    advance(100);
    adapter.recordResolver(resolverMetric);
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it('keeps category state bounded by the global emission limit', () => {
    const { adapter } = resolverHarness({ maxEmissionsPerWindow: 2 });
    for (const outcome of ['MATCH', 'NO_MATCH', 'UNAVAILABLE', 'ERROR'] as const) {
      adapter.recordResolver({ ...resolverMetric, outcome });
    }
    const emittedCategories = (
      adapter as unknown as { emittedCategories: Set<string> }
    ).emittedCategories;
    expect(emittedCategories.size).toBe(2);
  });

  it('emits only scope, bounded resource type, outcome, and latency bucket', () => {
    const { adapter, logger } = resolverHarness();
    adapter.recordResolver({
      ...resolverMetric,
      employeeId: 'employee-secret',
      sessionId: 'session-secret',
      accountId: 'account-secret',
      roleId: 'role-secret',
      resourceId: 'resource-secret',
      scopeBindingId: 'binding-secret',
      email: 'employee@example.com',
      projectId: 'project-secret',
      customerId: 'customer-secret',
      opaqueId: 'opaque-secret',
    } as never);
    expect(logger.info).toHaveBeenCalledWith('authorization.scope_resolver.metric', {
      ...resolverMetric,
    });
  });

  it('does not let a logging failure affect resolver evaluation', () => {
    const { adapter, logger } = resolverHarness();
    vi.mocked(logger.info).mockImplementationOnce(() => {
      throw new Error('sink failed');
    });
    expect(() => adapter.recordResolver(resolverMetric)).not.toThrow();
    adapter.recordResolver(resolverMetric);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});
