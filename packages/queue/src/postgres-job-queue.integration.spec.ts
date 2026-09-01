import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient, QueueJobStatus, type DatabaseClient } from '@dar-tech/database';
import { QueueDeduplicationConflictError } from './errors.js';
import { PostgresJobQueue } from './postgres-job-queue.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationQueue = 'foundation-integration';
const immediatelyEligibleAt = new Date('2000-01-01T00:00:00.000Z');

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

  it('deduplicates identical content and rejects conflicting key reuse', async () => {
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

  it('persists retry metadata and terminal failure at max attempts', async () => {
    const enqueued = await queue.enqueue({
      queue: integrationQueue,
      name: 'foundation.integration-probe',
      version: 1,
      payload: { probe: true },
      correlationId: 'correlation-final-state',
      availableAt: immediatelyEligibleAt,
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
        message: 'postgresql://admin:secret@db.invalid/example Bearer private-token',
      },
      retryAt: new Date(0),
    });
    const pending = await client.queueJob.findUniqueOrThrow({ where: { id: enqueued.jobId } });
    expect(pending.status).toBe(QueueJobStatus.PENDING);
    expect(pending.lastErrorMessage).toContain('[REDACTED]');
    expect(pending.lastErrorMessage).not.toMatch(/admin|secret|private-token/u);

    const finalClaim = await queue.claimNext(claimOptions);
    if (!finalClaim) throw new Error('Expected final queue claim');
    await queue.fail({
      job: finalClaim,
      failure: { code: 'foundation.final', message: 'Controlled final failure' },
      retryAt: new Date(Date.now() + 60_000),
    });

    const failed = await client.queueJob.findUniqueOrThrow({ where: { id: enqueued.jobId } });
    expect(failed).toMatchObject({
      status: QueueJobStatus.FAILED,
      attemptCount: 2,
      lastErrorCode: 'foundation.final',
      leaseToken: null,
    });
    expect(failed.failedAt).toBeInstanceOf(Date);
  });
});
