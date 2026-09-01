import { describe, expect, it } from 'vitest';
import { CappedExponentialRetryPolicy } from './retry-policy.js';

describe('CappedExponentialRetryPolicy', () => {
  it('grows exponentially and stops at the configured cap', () => {
    const policy = new CappedExponentialRetryPolicy({ baseDelayMs: 100, maxDelayMs: 350 });
    expect([1, 2, 3, 4].map((attempt) => policy.delayMs(attempt))).toEqual([100, 200, 350, 350]);
  });

  it('rejects invalid bounds and attempt numbers', () => {
    expect(
      () => new CappedExponentialRetryPolicy({ baseDelayMs: 100, maxDelayMs: 99 }),
    ).toThrow(RangeError);
    const policy = new CappedExponentialRetryPolicy({ baseDelayMs: 100, maxDelayMs: 200 });
    expect(() => policy.delayMs(0)).toThrow(RangeError);
  });
});
