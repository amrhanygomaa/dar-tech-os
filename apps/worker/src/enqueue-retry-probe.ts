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
  const queue = new PostgresJobQueue(client);
  const successfulProbeId = randomUUID();
  const successfulCorrelationId = randomUUID();
  const successfulInput = createRetryProbeJob({
      probeId: successfulProbeId,
      failuresBeforeSuccess: 2,
      correlationId: successfulCorrelationId,
      deduplicationKey: `retry-probe:${successfulProbeId}`,
      maxAttempts: Math.max(3, config.jobMaxAttempts),
    });
  const retryToSuccess = await queue.enqueue(successfulInput);
  const duplicate = await queue.enqueue(successfulInput);

  const terminalProbeId = randomUUID();
  const terminalCorrelationId = randomUUID();
  const terminalFailure = await queue.enqueue(
    createRetryProbeJob({
      probeId: terminalProbeId,
      failuresBeforeSuccess: 2,
      correlationId: terminalCorrelationId,
      deduplicationKey: `retry-probe:${terminalProbeId}`,
      maxAttempts: 2,
    }),
  );

  process.stdout.write(
    `${JSON.stringify({
      retryToSuccess: {
        ...retryToSuccess,
        correlationId: successfulCorrelationId,
        probeId: successfulProbeId,
      },
      duplicate,
      terminalFailure: {
        ...terminalFailure,
        correlationId: terminalCorrelationId,
        probeId: terminalProbeId,
      },
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
