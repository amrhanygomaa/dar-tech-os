import { describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '@dar-tech/observability';
import type { AuthorizationMetricsPort } from './authorization.contracts.js';
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

const decision: Parameters<AuthorizationMetricsPort['record']>[0] = {
  outcome: 'allowed',
  reasonCode: 'AUTHORIZED',
  actionFamily: 'admin.employee',
  scopeType: 'ORGANIZATION',
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

describe('StructuredAuthorizationResolverMetricsAdapter safe dimensions', () => {
  it('emits only scope, bounded resource type, outcome, and latency bucket', () => {
    const logger = { info: vi.fn() } as unknown as StructuredLogger;
    const adapter = new StructuredAuthorizationResolverMetricsAdapter(logger);
    adapter.recordResolver({
      scopeType: 'PROJECT',
      resourceType: 'employee',
      outcome: 'NO_MATCH',
      latencyBucket: 'LT_25_MS',
      employeeId: 'employee-secret',
      resourceId: 'resource-secret',
      scopeBindingId: 'binding-secret',
    } as never);
    expect(logger.info).toHaveBeenCalledWith('authorization.scope_resolver.metric', {
      scopeType: 'PROJECT',
      resourceType: 'employee',
      outcome: 'NO_MATCH',
      latencyBucket: 'LT_25_MS',
    });
  });

  it('does not let a logging failure affect resolver evaluation', () => {
    const logger = {
      info: () => { throw new Error('sink failed'); },
    } as unknown as StructuredLogger;
    const adapter = new StructuredAuthorizationResolverMetricsAdapter(logger);
    expect(() =>
      adapter.recordResolver({
        scopeType: 'CUSTOMER',
        resourceType: 'employee',
        outcome: 'ERROR',
        latencyBucket: 'LT_5_MS',
      }),
    ).not.toThrow();
  });
});
