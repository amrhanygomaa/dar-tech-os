import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '@dar-tech/observability';
import type {
  ClaimedJob,
  ClaimJobOptions,
  EnqueueJobInput,
  EnqueueJobResult,
  FailClaimedJobInput,
  JobHandler,
  JobProcessingLogger,
  JobQueuePort,
} from './contracts.js';
import { RetryableJobError } from './errors.js';
import { JobHandlerRegistry } from './job-handler-registry.js';
import { JobProcessor } from './job-processor.js';
import { CappedExponentialRetryPolicy } from './retry-policy.js';

class MemoryQueue implements JobQueuePort {
  readonly failures: FailClaimedJobInput[] = [];
  readonly completed: ClaimedJob[] = [];
  private attemptNumber = 0;
  private available = true;

  constructor(private readonly maxAttempts: number) {}

  enqueue(_input: EnqueueJobInput): Promise<EnqueueJobResult> {
    throw new Error('Not used by this test');
  }

  claimNext(_options: ClaimJobOptions): Promise<ClaimedJob | null> {
    if (!this.available || this.attemptNumber >= this.maxAttempts) {
      return Promise.resolve(null);
    }
    this.available = false;
    this.attemptNumber += 1;
    return Promise.resolve({
      id: '018f53d4-2f68-7c52-a399-3df2364d86ac',
      queue: 'foundation',
      name: 'foundation.test-job',
      version: 1,
      payload: { value: 'safe' },
      organizationId: null,
      correlationId: 'correlation-test-42',
      causationId: null,
      attemptNumber: this.attemptNumber,
      maxAttempts: this.maxAttempts,
      leaseToken: `018f53d4-2f68-7c52-a399-3df2364d86a${this.attemptNumber}`,
    });
  }

  complete(job: ClaimedJob): Promise<void> {
    this.completed.push(job);
    return Promise.resolve();
  }

  fail(input: FailClaimedJobInput): Promise<void> {
    this.failures.push(input);
    this.available = input.retryAt !== null;
    return Promise.resolve();
  }
}

function createLogger(): JobProcessingLogger {
  return { info: vi.fn(), warnEvent: vi.fn(), errorEvent: vi.fn() };
}

describe('JobProcessor', () => {
  it('propagates correlation context across retries and later succeeds', async () => {
    const queue = new MemoryQueue(5);
    const contextStore = new RequestContextStore();
    const observedContexts: unknown[] = [];
    const handler: JobHandler = {
      name: 'foundation.test-job',
      version: 1,
      handle: (job) => {
        observedContexts.push(contextStore.get());
        if (job.attemptNumber <= 2) {
          throw new RetryableJobError('foundation.controlled_retry');
        }
        return Promise.resolve();
      },
    };
    const processor = new JobProcessor(
      queue,
      new JobHandlerRegistry([handler]),
      contextStore,
      createLogger(),
      new CappedExponentialRetryPolicy({ baseDelayMs: 1_000, maxDelayMs: 2_500 }),
      { now: () => new Date('2026-09-01T00:00:00.000Z') },
    );
    const options = {
      queue: 'foundation',
      workerId: 'worker-test-1',
      leaseDurationMs: 30_000,
    } as const;

    await processor.processNext(options);
    await processor.processNext(options);
    await processor.processNext(options);

    expect(queue.failures.map(({ retryAt }) => retryAt?.toISOString())).toEqual([
      '2026-09-01T00:00:01.000Z',
      '2026-09-01T00:00:02.000Z',
    ]);
    expect(queue.completed).toHaveLength(1);
    expect(observedContexts).toEqual(
      Array.from({ length: 3 }, () => ({
        runtime: 'worker',
        jobId: '018f53d4-2f68-7c52-a399-3df2364d86ac',
        correlationId: 'correlation-test-42',
      })),
    );
    expect(contextStore.get()).toBeUndefined();
  });

  it('caps delays and records terminal failure at maxAttempts', async () => {
    const queue = new MemoryQueue(4);
    const handler: JobHandler = {
      name: 'foundation.test-job',
      version: 1,
      handle: () => Promise.reject(new Error('private failure detail')),
    };
    const processor = new JobProcessor(
      queue,
      new JobHandlerRegistry([handler]),
      new RequestContextStore(),
      createLogger(),
      new CappedExponentialRetryPolicy({ baseDelayMs: 1_000, maxDelayMs: 2_500 }),
      { now: () => new Date('2026-09-01T00:00:00.000Z') },
    );
    const options = {
      queue: 'foundation',
      workerId: 'worker-test-1',
      leaseDurationMs: 30_000,
    } as const;

    for (let count = 0; count < 4; count += 1) {
      await processor.processNext(options);
    }

    expect(
      queue.failures.map(({ retryAt }) =>
        retryAt ? retryAt.getTime() - Date.parse('2026-09-01T00:00:00.000Z') : null,
      ),
    ).toEqual([1_000, 2_000, 2_500, null]);
    expect(queue.failures.at(-1)?.failure).toEqual({
      code: 'queue.handler_failed',
      message: 'Job processing failed',
    });
    expect(JSON.stringify(queue.failures)).not.toContain('private failure detail');
  });

  it('terminally fails an unregistered job without retrying', async () => {
    const queue = new MemoryQueue(5);
    const processor = new JobProcessor(
      queue,
      new JobHandlerRegistry([]),
      new RequestContextStore(),
      createLogger(),
      new CappedExponentialRetryPolicy({ baseDelayMs: 1_000, maxDelayMs: 2_500 }),
      { now: () => new Date('2026-09-01T00:00:00.000Z') },
    );

    await processor.processNext({
      queue: 'foundation',
      workerId: 'worker-test-1',
      leaseDurationMs: 30_000,
    });

    expect(queue.failures[0]?.retryAt).toBeNull();
    expect(queue.failures[0]?.failure.code).toBe('queue.handler_not_registered');
  });
});
