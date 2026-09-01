import { describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '@dar-tech/observability';
import type { DatabaseReadinessPort } from './database-readiness.port.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('keeps liveness independent from external dependencies', () => {
    const database = { check: vi.fn() } satisfies DatabaseReadinessPort;
    const service = new HealthService(database);

    expect(service.liveness()).toEqual({ status: 'ok' });
    expect(database.check).not.toHaveBeenCalled();
  });

  it('reports readiness only when PostgreSQL is available', async () => {
    const database = {
      check: vi.fn().mockResolvedValue({ status: 'up', latencyMs: 4 }),
    } satisfies DatabaseReadinessPort;
    const service = new HealthService(database);

    await expect(service.readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: { status: 'up', latencyMs: 4 } },
    });
  });

  it('fails readiness safely when PostgreSQL is unavailable', async () => {
    const database = {
      check: vi.fn().mockResolvedValue({ status: 'down', latencyMs: 9 }),
    } satisfies DatabaseReadinessPort;
    const service = new HealthService(database);

    await expect(service.readiness()).rejects.toMatchObject<ApplicationError>({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      safeMessage: 'Service is not ready',
    });
    await expect(service.health()).resolves.toEqual({
      status: 'degraded',
      checks: { database: { status: 'down', latencyMs: 9 } },
    });
  });
});
