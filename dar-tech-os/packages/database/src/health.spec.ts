import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from './client.js';
import { checkDatabaseHealth } from './health.js';

describe('database health check', () => {
  it('reports an available database without exposing query details', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const client = { $queryRaw: queryRaw } as unknown as DatabaseClient;

    const result = await checkDatabaseHealth(client);

    expect(result.status).toBe('up');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('returns a safe down result when the dependency fails', async () => {
    const client = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('postgresql://secret@database')),
    } as unknown as DatabaseClient;

    await expect(checkDatabaseHealth(client)).resolves.toEqual({
      status: 'down',
      latencyMs: expect.any(Number),
    });
  });
});
