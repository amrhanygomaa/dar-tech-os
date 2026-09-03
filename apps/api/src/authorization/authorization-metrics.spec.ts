import { describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '@dar-tech/observability';
import { StructuredAuthorizationMetricsAdapter } from './authorization-metrics.js';
import type { AuthorizationMetricsPort } from './authorization.contracts.js';

describe('StructuredAuthorizationMetricsAdapter bounded observability', () => {
  function createHarness(options?: { windowMs?: number; maxEntries?: number; now?: () => number }) {
    let currentTime = 1_000_000;
    const logger: StructuredLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as StructuredLogger;

    const adapter = new StructuredAuthorizationMetricsAdapter(logger, {
      windowMs: options?.windowMs ?? 60_000,
      maxEntries: options?.maxEntries ?? 256,
      now: options?.now ?? (() => currentTime),
    });

    return {
      adapter,
      logger,
      advanceTime: (ms: number) => {
        currentTime += ms;
      },
    };
  }

  it('emits the first bounded decision metric', () => {
    const { adapter, logger } = createHarness();
    adapter.record({
      outcome: 'allowed',
      reasonCode: 'AUTHORIZED',
      actionFamily: 'admin.employee',
      scopeType: 'ORGANIZATION',
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('authorization.decision.metric', {
      outcome: 'allowed',
      reasonCode: 'AUTHORIZED',
      actionFamily: 'admin.employee',
      scopeType: 'ORGANIZATION',
    });
  });

  it('rate-controls repeated routine identical decisions within the window', () => {
    const { adapter, logger } = createHarness();
    const decision: Parameters<AuthorizationMetricsPort['record']>[0] = {
      outcome: 'allowed',
      reasonCode: 'AUTHORIZED',
      actionFamily: 'admin.employee',
      scopeType: 'ORGANIZATION',
    };

    adapter.record(decision);
    adapter.record(decision);
    adapter.record(decision);
    adapter.record(decision);

    // Only the first decision was emitted; the repeated 3 were suppressed
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('emits different bounded categories independently', () => {
    const { adapter, logger } = createHarness();

    adapter.record({
      outcome: 'allowed',
      reasonCode: 'AUTHORIZED',
      actionFamily: 'admin.employee',
      scopeType: 'ORGANIZATION',
    });

    adapter.record({
      outcome: 'denied',
      reasonCode: 'SCOPE_NOT_SATISFIED',
      actionFamily: 'admin.role',
      scopeType: 'SELF',
    });

    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it('allows periodic observation of repeated categories after the window expires', () => {
    const { adapter, logger, advanceTime } = createHarness({ windowMs: 60_000 });
    const decision: Parameters<AuthorizationMetricsPort['record']>[0] = {
      outcome: 'allowed',
      reasonCode: 'AUTHORIZED',
      actionFamily: 'admin.employee',
      scopeType: 'ORGANIZATION',
    };

    adapter.record(decision);
    expect(logger.info).toHaveBeenCalledTimes(1);

    advanceTime(30_000);
    adapter.record(decision);
    expect(logger.info).toHaveBeenCalledTimes(1); // Still within 60s window

    advanceTime(30_001); // Exceeds 60s window
    adapter.record(decision);
    expect(logger.info).toHaveBeenCalledTimes(2); // Emitted again
  });

  it('never logs high-cardinality or sensitive fields', () => {
    const { adapter, logger } = createHarness();
    const untrustedPayload = {
      outcome: 'denied' as const,
      reasonCode: 'ORGANIZATION_MISMATCH' as const,
      actionFamily: 'admin.employee',
      scopeType: 'ORGANIZATION' as const,
      // Potential sensitive / high-cardinality fields that must not be emitted
      employeeId: 'emp-12345',
      sessionId: 'sess-abcde',
      resourceId: 'res-99999',
      roleId: 'role-admin',
      bindingId: 'bind-456',
      email: 'secret@dartech.com',
      secret: 'super-secret',
    };

    adapter.record(untrustedPayload as unknown as Parameters<AuthorizationMetricsPort['record']>[0]);

    expect(logger.info).toHaveBeenCalledTimes(1);
    const loggedObject = vi.mocked(logger.info).mock.calls[0][1];
    expect(loggedObject).toEqual({
      outcome: 'denied',
      reasonCode: 'ORGANIZATION_MISMATCH',
      actionFamily: 'admin.employee',
      scopeType: 'ORGANIZATION',
    });
    expect(Object.keys(loggedObject).sort()).toEqual([
      'actionFamily',
      'outcome',
      'reasonCode',
      'scopeType',
    ]);
  });

  it('collapses invalid or attacker-supplied actionFamily to invalid', () => {
    const { adapter, logger } = createHarness();
    adapter.record({
      outcome: 'denied',
      reasonCode: 'PERMISSION_INVALID',
      actionFamily: 'attacker-controlled-string-with-special-chars!@#$%',
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('authorization.decision.metric', {
      outcome: 'denied',
      reasonCode: 'PERMISSION_INVALID',
      actionFamily: 'invalid',
    });
  });

  it('enforces strictly bounded memory via maxEntries and cache pruning', () => {
    const maxEntries = 5;
    const { adapter, advanceTime } = createHarness({ maxEntries, windowMs: 10_000 });

    for (let i = 0; i < 20; i++) {
      adapter.record({
        outcome: i % 2 === 0 ? 'allowed' : 'denied',
        reasonCode: 'AUTHORIZED',
        actionFamily: `family_${i}`.replace(/[^a-z0-9_]/g, ''),
      });
      advanceTime(1_000);
    }

    // Access private cache to verify bounded size
    const cache = (adapter as unknown as { cache: Map<string, unknown> }).cache;
    expect(cache.size).toBeLessThanOrEqual(maxEntries);
  });

  it('safely swallows logger errors without throwing', () => {
    const { adapter, logger } = createHarness();
    vi.mocked(logger.info).mockImplementationOnce(() => {
      throw new Error('Logger transport failure');
    });

    expect(() => {
      adapter.record({
        outcome: 'allowed',
        reasonCode: 'AUTHORIZED',
        actionFamily: 'admin.employee',
      });
    }).not.toThrow();
  });
});
