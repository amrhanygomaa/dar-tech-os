import { describe, expect, it } from 'vitest';
import { RetryableJobError } from './errors.js';
import { RetryProbeJobHandler, createRetryProbeJob } from './retry-probe.job.js';

describe('retry probe job', () => {
  it('creates a deduplicated technical job and succeeds after requested failures', async () => {
    const input = createRetryProbeJob({
      probeId: 'probe-1',
      failuresBeforeSuccess: 1,
      correlationId: 'correlation-1',
      deduplicationKey: 'probe:1',
      maxAttempts: 3,
    });
    const handler = new RetryProbeJobHandler();
    const base = {
      id: '018f53d4-2f68-7c52-a399-3df2364d86ac',
      queue: input.queue,
      name: input.name,
      version: input.version,
      payload: input.payload,
      organizationId: null,
      correlationId: input.correlationId,
      causationId: null,
      maxAttempts: input.maxAttempts,
      leaseToken: '018f53d4-2f68-7c52-a399-3df2364d86ad',
    } as const;

    await expect(handler.handle({ ...base, attemptNumber: 1 })).rejects.toBeInstanceOf(
      RetryableJobError,
    );
    await expect(handler.handle({ ...base, attemptNumber: 2 })).resolves.toBeUndefined();
    expect(input.deduplicationKey).toBe('probe:1');
  });
});
