import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadWorkerConfig } from '@dar-tech/config';
import { createPrismaClient } from '@dar-tech/database';
import { PostgresJobQueue, createRetryProbeJob } from '@dar-tech/queue';

const config = loadWorkerConfig(process.env);
const client = createPrismaClient({
  databaseUrl: config.databaseUrl,
  poolMax: config.databasePoolMax,
  connectTimeoutMs: config.databaseConnectTimeoutMs,
  idleTimeoutMs: config.databaseIdleTimeoutMs,
  errorFormat: config.appEnvironment === 'production' ? 'minimal' : 'pretty',
});

async function enqueueRetryProbe(): Promise<void> {
  const probeId = randomUUID();
  const correlationId = randomUUID();
  const queue = new PostgresJobQueue(client);
  const result = await queue.enqueue(
    createRetryProbeJob({
      probeId,
      failuresBeforeSuccess: 2,
      correlationId,
      deduplicationKey: `retry-probe:${probeId}`,
      maxAttempts: config.jobMaxAttempts,
    }),
  );

  process.stdout.write(
    `${JSON.stringify({
      jobId: result.jobId,
      deduplicated: result.deduplicated,
      correlationId,
    })}\n`,
  );
}

void enqueueRetryProbe()
  .catch(() => {
    process.stderr.write('Retry probe enqueue failed safely\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.$disconnect();
  });
