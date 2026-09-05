import type { DatabaseClient } from './client.js';

export interface DatabaseHealthResult {
  readonly status: 'up' | 'down';
  readonly latencyMs: number;
}

export async function checkDatabaseHealth(
  client: DatabaseClient,
  timeoutMs = 2_000,
): Promise<DatabaseHealthResult> {
  const startedAt = performance.now();
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Database health check timed out')), timeoutMs);
      }),
    ]);

    return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { status: 'down', latencyMs: Math.round(performance.now() - startedAt) };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
