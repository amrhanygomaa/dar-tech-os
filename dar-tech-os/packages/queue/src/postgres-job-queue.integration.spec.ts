import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  QueueJobStatus,
  type DatabaseClient,
} from '@dar-tech/database';
import {
  QueueDeduplicationConflictError,
  QueueLeaseLostError,
} from './errors.js';
import { PostgresJobQueue } from './postgres-job-queue.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationQueue = 'foundation-integration';

describe.skipIf(!databaseUrl)('PostgresJobQueue integration', () => {
  let client: DatabaseClient;
  let queue: PostgresJobQueue;

  beforeAll(() => {
    client = createPrismaClient({ databaseUrl: databaseUrl as string });
    queue = new PostgresJobQueue(client);
  });

  beforeEach(async () => {
    await client.queueJob.deleteMany({ where: { queue: integrationQueue } });
  });

  afterAll(async () => {
    await client.queueJob.deleteMany({ where: { queue: integrationQueue } });
    await client.$disconnect();
  });

  it('deduplicates identical content and rejects key reuse with different content', async () => {
    const first = await queue.enqueue({
      queue: integrationQueue,
      name: 'foundation.integration-probe',
      version: 1,
      payload: { alpha: 1, nested: { beta: 2 } },
      correlationId: 'correlation-integration-1',
      deduplicationKey: 'dedup-1',
      maxAttempts: 3,
    });
    const duplicate = await queue.enqueue({
      queue: integrationQueue,
      name: 'foundation.integration-probe',
      version: 1,
      payload: { nested: { beta: 2 }, alpha: 1 },
      correlationId: 'correlation-integration-2',
      deduplicationKey: 'dedup-1',
      maxAttempts: 3,
    });

    expect(duplicate).toEqual({ jobId: first.jobId, deduplicated: true });
    await expect(
      queue.enqueue({
        queue: integrationQueue,
        name: 'foundation.integration-probe',
        version: 1,
        payload: { alpha: 999 },
        correlationId: 'correlation-integration-3',
        deduplicationKey: 'dedup-1',
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(QueueDeduplicationConflictError);
  });

  it('persists a safe retry then transitions the final attempt to FAILED', async () => {
    const enqueued = await queue.enqueue({
      queue: integrationQueue,
      name: 'foundation.integration-probe',
      version: 1,
      payload: { probe: true },
      correlationId: 'correlation-final-state',
      maxAttempts: 2,
    });
    const claimOptions = {
      queue: integrationQueue,
      workerId: 'worker-integration-1',
      leaseDurationMs: 30_000,
    } as const;
    const firstClaim = await queue.claimNext(claimOptions);
    expect(firstClaim?.correlationId).toBe('correlation-final-state');
    if (!firstClaim) throw new Error('Expected first queue claim');

    await queue.fail({
      job: firstClaim,
      failure: {
        code: 'foundation.retry',
        message:
          'postgresql://admin:secret@db.invalid/example Bearer private-token password=hunter2',
      },
      retryAt: new Date(0),
    });
    const pending = await client.queueJob.findUniqueOrThrow({
      where: { id: enqueued.jobId },
    });
    expect(pending.status).toBe(QueueJobStatus.PENDING);
    expect(pending.lastErrorMessage).toContain('[REDACTED]');
    expect(pending.lastErrorMessage).not.toMatch(
      /admin|secret|private-token|hunter2/u,
    );

    const finalClaim = await queue.claimNext(claimOptions);
    if (!finalClaim) throw new Error('Expected final queue claim');
    await queue.fail({
      job: finalClaim,
      failure: {
        code: 'foundation.final',
        message: 'Controlled final failure',
      },
      retryAt: new Date(Date.now() + 60_000),
    });

    const failed = await client.queueJob.findUniqueOrThrow({
      where: { id: enqueued.jobId },
    });
    expect(failed).toMatchObject({
      status: QueueJobStatus.FAILED,
      attemptCount: 2,
      lastErrorCode: 'foundation.final',
      leaseToken: null,
    });
    expect(failed.failedAt).toBeInstanceOf(Date);
  });

  it('recovers null leases, terminalizes exhausted work, and rejects stale acknowledgements', async () => {
    const recoverable = await queue.enqueue({
      queue: integrationQueue,
      name: 'foundation.integration-probe',
      version: 1,
      payload: {},
      correlationId: 'correlation-recovery',
      maxAttempts: 2,
    });
    await client.queueJob.update({
      where: { id: recoverable.jobId },
      data: {
        status: QueueJobStatus.PROCESSING,
        attemptCount: 1,
        lockedBy: 'dead-worker',
        leaseToken: randomUUID(),
        lockExpiresAt: null,
      },
    });
    const recovered = await queue.claimNext({
      queue: integrationQueue,
      workerId: 'worker-integration-2',
      leaseDurationMs: 30_000,
    });
    expect(recovered?.attemptNumber).toBe(2);
    if (!recovered) throw new Error('Expected recovered queue claim');
    await queue.complete(recovered);
    await expect(queue.complete(recovered)).rejects.toBeInstanceOf(
      QueueLeaseLostError,
    );

    const pendingExhausted = await queue.enqueue({
      queue: integrationQueue,
      name: 'foundation.integration-probe',
      version: 1,
      payload: { exhausted: 'pending' },
      correlationId: 'correlation-exhausted-pending',
      maxAttempts: 1,
    });
    const processingExhausted = await queue.enqueue({
      queue: integrationQueue,
      name: 'foundation.integration-probe',
      version: 1,
      payload: { exhausted: 'processing' },
      correlationId: 'correlation-exhausted-processing',
      maxAttempts: 1,
    });
    await client.queueJob.update({
      where: { id: pendingExhausted.jobId },
      data: { attemptCount: 1 },
    });
    await client.queueJob.update({
      where: { id: processingExhausted.jobId },
      data: {
        status: QueueJobStatus.PROCESSING,
        attemptCount: 1,
        lockedBy: 'dead-worker',
        leaseToken: randomUUID(),
        lockExpiresAt: null,
      },
    });

    await expect(
      queue.claimNext({
        queue: integrationQueue,
        workerId: 'worker-integration-2',
        leaseDurationMs: 30_000,
      }),
    ).resolves.toBeNull();
    const exhausted = await client.queueJob.findMany({
      where: {
        id: { in: [pendingExhausted.jobId, processingExhausted.jobId] },
      },
    });
    expect(exhausted.map(({ status }) => status)).toEqual([
      QueueJobStatus.FAILED,
      QueueJobStatus.FAILED,
    ]);
  });
});
