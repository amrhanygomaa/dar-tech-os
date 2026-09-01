import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadWorkerConfig } from '@dar-tech/config';
import { createPrismaClient, runInTransaction } from '@dar-tech/database';
import { createReferenceOutboxEvent } from '@dar-tech/outbox';

const config = loadWorkerConfig(process.env);
const client = createPrismaClient({
  databaseUrl: config.databaseUrl,
  poolMax: config.databasePoolMax,
  connectTimeoutMs: config.databaseConnectTimeoutMs,
  idleTimeoutMs: config.databaseIdleTimeoutMs,
  errorFormat: config.appEnvironment === 'production' ? 'minimal' : 'pretty',
});

async function enqueueReferenceOutboxEvent(): Promise<void> {
  const referenceId = randomUUID();
  const correlationId = randomUUID();
  const result = await runInTransaction(client, (transaction) =>
    createReferenceOutboxEvent(transaction, {
      referenceId,
      failuresBeforeSuccess: 1,
      correlationId,
    }),
  );
  process.stdout.write(`${JSON.stringify({ ...result, correlationId, referenceId })}\n`);
}

void enqueueReferenceOutboxEvent()
  .catch(() => {
    process.stderr.write('Reference outbox enqueue failed safely\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.$disconnect();
  });
