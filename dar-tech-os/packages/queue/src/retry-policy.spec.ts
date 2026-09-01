import { describe, expect, it } from 'vitest';
import { CappedExponentialRetryPolicy } from './retry-policy.js';

describe('CappedExponentialRetryPolicy', () => {
  it('increases exponentially and stops at the configured cap', () => {
    const policy = new CappedExponentialRetryPolicy({
      baseDelayMs: 1_000,
      maxDelayMs: 2_500,
    });

    expect([1, 2, 3, 4].map((attempt) => policy.delayMs(attempt))).toEqual([
      1_000, 2_000, 2_500, 2_500,
    ]);
  });

  it('rejects invalid bounds and attempt numbers', () => {
    expect(
      () =>
        new CappedExponentialRetryPolicy({
          baseDelayMs: 2_000,
          maxDelayMs: 1_000,
        }),
    ).toThrow(RangeError);
    const policy = new CappedExponentialRetryPolicy({
      baseDelayMs: 1,
      maxDelayMs: 1,
    });
    expect(() => policy.delayMs(0)).toThrow(RangeError);
  });
});
