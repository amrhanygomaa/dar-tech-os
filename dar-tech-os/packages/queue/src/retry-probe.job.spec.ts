import { describe, expect, it } from 'vitest';
import { RetryableJobError } from './errors.js';
import {
  RetryProbeJobHandler,
  createRetryProbeJob,
} from './retry-probe.job.js';

describe('technical retry probe job', () => {
  it('creates an explicitly versioned, non-business queue message', () => {
    expect(
      createRetryProbeJob({
        probeId: 'probe-1',
        failuresBeforeSuccess: 2,
        correlationId: 'correlation-1',
        deduplicationKey: 'probe:probe-1',
        maxAttempts: 5,
      }),
    ).toMatchObject({
      queue: 'foundation',
      name: 'foundation.retry-probe',
      version: 1,
      payload: { probeId: 'probe-1', failuresBeforeSuccess: 2 },
    });
  });

  it('requests controlled retries based on persisted attempt metadata', async () => {
    const handler = new RetryProbeJobHandler();
    const job = {
      id: '018f53d4-2f68-7c52-a399-3df2364d86ac',
      queue: 'foundation',
      name: 'foundation.retry-probe',
      version: 1,
      payload: { probeId: 'probe-1', failuresBeforeSuccess: 1 },
      organizationId: null,
      correlationId: 'correlation-1',
      causationId: null,
      maxAttempts: 3,
      leaseToken: '018f53d4-2f68-7c52-a399-3df2364d86ad',
    } as const;

    await expect(
      handler.handle({ ...job, attemptNumber: 1 }),
    ).rejects.toBeInstanceOf(RetryableJobError);
    await expect(
      handler.handle({ ...job, attemptNumber: 2 }),
    ).resolves.toBeUndefined();
  });
});
