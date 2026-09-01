import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPrismaClient,
  OutboxEventStatus,
  QueueJobStatus,
  runInTransaction,
  type DatabaseClient,
  type DatabaseTransaction,
} from '@dar-tech/database';
import { RequestContextStore } from '@dar-tech/observability';
import {
  JobHandlerRegistry,
  JobProcessor,
  PostgresJobQueue,
  type ClaimedJob,
  type ClaimJobOptions,
  type EnqueueJobInput,
  type EnqueueJobResult,
  type FailClaimedJobInput,
  type JobQueuePort,
} from '@dar-tech/queue';
import type {
  OutboxConsumer,
  OutboxConsumerExecution,
  OutboxEventEnvelope,
  OutboxLogger,
} from './contracts.js';
import { OutboxDeliveryJobHandler } from './outbox-delivery.job.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { PostgresOutboxStore } from './postgres-outbox-store.js';
import {
  REFERENCE_OUTBOX_ROUTE,
  ReferenceOutboxConsumer,
  createReferenceOutboxEvent,
} from './reference-event.js';
import { OutboxConsumerRegistry, OutboxRouteRegistry } from './route-registry.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const immediatelyEligibleAt = new Date('2000-01-01T00:00:00.000Z');

function logger(): OutboxLogger {
  return { info: vi.fn(), warnEvent: vi.fn(), errorEvent: vi.fn() };
}

describe.skipIf(!databaseUrl)('transactional outbox reference flow', () => {
  let client: DatabaseClient;

  beforeAll(() => {
    client = createPrismaClient({ databaseUrl: databaseUrl as string });
  });

  beforeEach(async () => {
    await client.outboxConsumerReceipt.deleteMany();
    await client.queueJob.deleteMany();
    await client.outboxEvent.deleteMany();
  });

  afterAll(async () => {
    await client.outboxConsumerReceipt.deleteMany();
    await client.queueJob.deleteMany();
    await client.outboxEvent.deleteMany();
    await client.$disconnect();
  });

  it('rolls outbox persistence back with the originating transaction', async () => {
    await expect(
      runInTransaction(client, async (transaction) => {
        await createReferenceOutboxEvent(transaction, {
          referenceId: 'rollback-reference',
          failuresBeforeSuccess: 0,
          correlationId: 'correlation-rollback',
        });
        throw new Error('controlled transaction rollback');
      }),
    ).rejects.toThrow('controlled transaction rollback');

    await expect(client.outboxEvent.count()).resolves.toBe(0);
  });

  it('dispatches, retries the consumer, propagates correlation, and skips duplicate processing', async () => {
    const contextStore = new RequestContextStore();
    const baseConsumer = new ReferenceOutboxConsumer();
    const observedContexts: unknown[] = [];
    const consumer: OutboxConsumer = {
      name: baseConsumer.name,
      eventType: baseConsumer.eventType,
      eventVersion: baseConsumer.eventVersion,
      handle: async (
        event: OutboxEventEnvelope,
        transaction: DatabaseTransaction,
        execution: OutboxConsumerExecution,
      ) => {
        observedContexts.push(contextStore.get());
        await baseConsumer.handle(event, transaction, execution);
      },
    };
    const { eventId } = await runInTransaction(client, (transaction) =>
      createReferenceOutboxEvent(transaction, {
        referenceId: 'reference-retry-once',
        failuresBeforeSuccess: 1,
        correlationId: 'correlation-reference-flow',
      }),
    );
    await client.outboxEvent.update({
      where: { id: eventId },
      data: { availableAt: immediatelyEligibleAt },
    });
    const queue = new PostgresJobQueue(client);
    const dispatcher = new OutboxDispatcher(
      new PostgresOutboxStore(client),
      queue,
      new OutboxRouteRegistry([REFERENCE_OUTBOX_ROUTE]),
      contextStore,
      logger(),
      { delayMs: () => 1 },
      { now: () => new Date(0) },
    );

    await dispatcher.dispatchNext({
      workerId: 'worker-outbox-integration',
      leaseDurationMs: 30_000,
      deliveryMaxAttempts: 3,
    });

    const dispatched = await client.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(dispatched.status).toBe(OutboxEventStatus.PROCESSED);
    const queued = await client.queueJob.findFirstOrThrow({
      where: { deduplicationKey: `outbox:${consumer.name}:${eventId}` },
    });
    await client.queueJob.update({
      where: { id: queued.id },
      data: { availableAt: immediatelyEligibleAt },
    });
    expect(queued.correlationId).toBe('correlation-reference-flow');

    const deliveryHandler = new OutboxDeliveryJobHandler(
      client,
      new OutboxConsumerRegistry([consumer]),
      logger(),
    );
    const processor = new JobProcessor(
      queue,
      new JobHandlerRegistry([deliveryHandler]),
      contextStore,
      logger(),
      { delayMs: () => 1 },
      { now: () => new Date(0) },
    );
    const processOptions = {
      queue: REFERENCE_OUTBOX_ROUTE.queue,
      workerId: 'worker-outbox-integration',
      leaseDurationMs: 30_000,
    } as const;

    await processor.processNext(processOptions);
    expect(await client.outboxConsumerReceipt.count()).toBe(0);
    await processor.processNext(processOptions);

    const succeeded = await client.queueJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(succeeded.status).toBe(QueueJobStatus.SUCCEEDED);
    expect(succeeded.attemptCount).toBe(2);
    expect(await client.outboxConsumerReceipt.count()).toBe(1);
    expect(observedContexts).toEqual([
      {
        runtime: 'worker',
        jobId: queued.id,
        correlationId: 'correlation-reference-flow',
      },
      {
        runtime: 'worker',
        jobId: queued.id,
        correlationId: 'correlation-reference-flow',
      },
    ]);

    await deliveryHandler.handle({
      id: queued.id,
      queue: queued.queue,
      name: queued.name,
      version: queued.version,
      payload: queued.payload,
      organizationId: queued.organizationId,
      correlationId: queued.correlationId,
      causationId: queued.causationId,
      attemptNumber: 3,
      maxAttempts: queued.maxAttempts,
      leaseToken: '018f53d4-2f68-7c52-a399-3df2364d86ad',
    });
    expect(observedContexts).toHaveLength(2);
    expect(await client.outboxConsumerReceipt.count()).toBe(1);
  });

  it('persists a dispatcher retry before successful provider handoff', async () => {
    const { eventId } = await runInTransaction(client, (transaction) =>
      createReferenceOutboxEvent(transaction, {
        referenceId: 'dispatcher-retry',
        failuresBeforeSuccess: 0,
        correlationId: 'correlation-dispatcher-retry',
        maxAttempts: 2,
      }),
    );
    await client.outboxEvent.update({
      where: { id: eventId },
      data: { availableAt: immediatelyEligibleAt },
    });
    let providerCalls = 0;
    const queue: JobQueuePort = {
      enqueue: (_input: EnqueueJobInput): Promise<EnqueueJobResult> => {
        providerCalls += 1;
        return providerCalls === 1
          ? Promise.reject(new Error('controlled provider failure'))
          : Promise.resolve({ jobId: 'delivery-job', deduplicated: false });
      },
      claimNext: (_options: ClaimJobOptions): Promise<ClaimedJob | null> => {
        throw new Error('Not used by this test');
      },
      complete: (_job: ClaimedJob): Promise<void> => {
        throw new Error('Not used by this test');
      },
      fail: (_input: FailClaimedJobInput): Promise<void> => {
        throw new Error('Not used by this test');
      },
    };
    const dispatcher = new OutboxDispatcher(
      new PostgresOutboxStore(client),
      queue,
      new OutboxRouteRegistry([REFERENCE_OUTBOX_ROUTE]),
      new RequestContextStore(),
      logger(),
      { delayMs: () => 1 },
      { now: () => new Date(0) },
    );
    const options = {
      workerId: 'worker-outbox-retry',
      leaseDurationMs: 30_000,
      deliveryMaxAttempts: 3,
    } as const;

    await dispatcher.dispatchNext(options);
    const pending = await client.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(pending).toMatchObject({
      status: OutboxEventStatus.PENDING,
      attemptCount: 1,
      lastErrorCode: 'outbox.provider_unavailable',
    });

    await dispatcher.dispatchNext(options);
    const processed = await client.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(processed.status).toBe(OutboxEventStatus.PROCESSED);
    expect(processed.attemptCount).toBe(2);
  });
});
