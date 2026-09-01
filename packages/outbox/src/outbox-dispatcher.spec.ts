import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '@dar-tech/observability';
import type {
  ClaimedJob,
  ClaimJobOptions,
  EnqueueJobInput,
  EnqueueJobResult,
  FailClaimedJobInput,
  JobQueuePort,
} from '@dar-tech/queue';
import type {
  ClaimedOutboxEvent,
  ClaimOutboxOptions,
  FailClaimedOutboxEventInput,
  OutboxLogger,
  OutboxStorePort,
} from './contracts.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { OutboxRouteRegistry } from './route-registry.js';

class MemoryOutboxStore implements OutboxStorePort {
  readonly failures: FailClaimedOutboxEventInput[] = [];
  readonly completed: ClaimedOutboxEvent[] = [];
  private attemptNumber = 0;
  private available = true;

  constructor(private readonly maxAttempts = 3) {}

  claimNext(_options: ClaimOutboxOptions): Promise<ClaimedOutboxEvent | null> {
    if (!this.available || this.attemptNumber >= this.maxAttempts) return Promise.resolve(null);
    this.available = false;
    this.attemptNumber += 1;
    return Promise.resolve({
      id: '018f53d4-2f68-7c52-a399-3df2364d86ac',
      eventType: 'foundation.reference-event',
      eventVersion: 1,
      payload: { referenceId: 'reference-1', failuresBeforeSuccess: 0 },
      organizationId: null,
      correlationId: 'correlation-outbox-1',
      causationId: null,
      occurredAt: new Date('2026-09-01T00:00:00.000Z'),
      attemptNumber: this.attemptNumber,
      maxAttempts: this.maxAttempts,
      leaseToken: `018f53d4-2f68-7c52-a399-3df2364d86a${this.attemptNumber}`,
    });
  }

  complete(event: ClaimedOutboxEvent): Promise<void> {
    this.completed.push(event);
    return Promise.resolve();
  }

  fail(input: FailClaimedOutboxEventInput): Promise<void> {
    this.failures.push(input);
    this.available = input.retryAt !== null;
    return Promise.resolve();
  }
}

class MemoryQueue implements JobQueuePort {
  readonly inputs: EnqueueJobInput[] = [];
  failFirst = false;

  enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult> {
    this.inputs.push(input);
    if (this.failFirst) {
      this.failFirst = false;
      return Promise.reject(new Error('provider detail'));
    }
    return Promise.resolve({ jobId: 'job-1', deduplicated: false });
  }

  claimNext(_options: ClaimJobOptions): Promise<ClaimedJob | null> {
    throw new Error('Not used by this test');
  }

  complete(_job: ClaimedJob): Promise<void> {
    throw new Error('Not used by this test');
  }

  fail(_input: FailClaimedJobInput): Promise<void> {
    throw new Error('Not used by this test');
  }
}

function logger(): OutboxLogger {
  return { info: vi.fn(), warnEvent: vi.fn(), errorEvent: vi.fn() };
}

describe('OutboxDispatcher', () => {
  it('retries provider failure, preserves correlation, and safely deduplicates delivery', async () => {
    const store = new MemoryOutboxStore();
    const queue = new MemoryQueue();
    queue.failFirst = true;
    const contextStore = new RequestContextStore();
    const observedCorrelations: Array<string | undefined> = [];
    const originalEnqueue = queue.enqueue.bind(queue);
    queue.enqueue = (input) => {
      observedCorrelations.push(contextStore.get()?.correlationId);
      return originalEnqueue(input);
    };
    const dispatcher = new OutboxDispatcher(
      store,
      queue,
      new OutboxRouteRegistry([
        {
          eventType: 'foundation.reference-event',
          eventVersion: 1,
          consumerName: 'foundation.reference-consumer',
          queue: 'foundation',
        },
      ]),
      contextStore,
      logger(),
      { delayMs: () => 1 },
      { now: () => new Date(0) },
    );
    const options = { workerId: 'worker-test', leaseDurationMs: 30_000, deliveryMaxAttempts: 3 };

    await dispatcher.dispatchNext(options);
    await dispatcher.dispatchNext(options);

    expect(store.failures).toHaveLength(1);
    expect(store.failures[0]?.failure).toEqual({
      code: 'outbox.provider_unavailable',
      message: 'Outbox delivery provider was unavailable',
    });
    expect(store.completed).toHaveLength(1);
    expect(observedCorrelations).toEqual(['correlation-outbox-1', 'correlation-outbox-1']);
    expect(queue.inputs[1]?.deduplicationKey).toBe(
      'outbox:foundation.reference-consumer:018f53d4-2f68-7c52-a399-3df2364d86ac',
    );
  });

  it('terminally fails an event with no registered route', async () => {
    const store = new MemoryOutboxStore();
    const dispatcher = new OutboxDispatcher(
      store,
      new MemoryQueue(),
      new OutboxRouteRegistry([]),
      new RequestContextStore(),
      logger(),
      { delayMs: () => 1 },
      { now: () => new Date(0) },
    );

    await dispatcher.dispatchNext({
      workerId: 'worker-test',
      leaseDurationMs: 30_000,
      deliveryMaxAttempts: 3,
    });

    expect(store.failures[0]?.retryAt).toBeNull();
    expect(store.failures[0]?.failure.code).toBe('outbox.route_not_registered');
  });

  it('stops retrying provider failure when dispatch attempts are exhausted', async () => {
    const store = new MemoryOutboxStore(2);
    const queue = new MemoryQueue();
    queue.enqueue = (input) => {
      queue.inputs.push(input);
      return Promise.reject(new Error('provider remains unavailable'));
    };
    const dispatcher = new OutboxDispatcher(
      store,
      queue,
      new OutboxRouteRegistry([
        {
          eventType: 'foundation.reference-event',
          eventVersion: 1,
          consumerName: 'foundation.reference-consumer',
          queue: 'foundation',
        },
      ]),
      new RequestContextStore(),
      logger(),
      { delayMs: () => 1 },
      { now: () => new Date(0) },
    );
    const options = { workerId: 'worker-test', leaseDurationMs: 30_000, deliveryMaxAttempts: 3 };

    await dispatcher.dispatchNext(options);
    await dispatcher.dispatchNext(options);

    expect(store.failures.map(({ retryAt }) => retryAt?.toISOString() ?? null)).toEqual([
      '1970-01-01T00:00:00.001Z',
      null,
    ]);
    expect(store.failures.at(-1)?.failure.code).toBe('outbox.provider_unavailable');
  });
});
