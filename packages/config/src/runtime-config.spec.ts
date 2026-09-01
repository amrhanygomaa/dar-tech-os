import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadApiConfig, loadWorkerConfig } from './runtime-config.js';

const validEnvironment: NodeJS.ProcessEnv = {
  APP_ENV: 'development',
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://dartech:dartech@localhost:5432/dartech_os',
};

describe('runtime configuration', () => {
  it('returns a typed API configuration for valid input', () => {
    expect(loadApiConfig(validEnvironment)).toEqual({
      runtime: 'api',
      appEnvironment: 'development',
      nodeEnvironment: 'development',
      logLevel: 'info',
      port: 3001,
      databaseUrl: validEnvironment.DATABASE_URL,
      databasePoolMax: 10,
      databaseConnectTimeoutMs: 5000,
      databaseIdleTimeoutMs: 30000,
    });
  });

  it('fails startup validation when critical values are missing', () => {
    expect(() => loadWorkerConfig({})).toThrow(ConfigValidationError);

    try {
      loadWorkerConfig({});
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).fields).toEqual([
        'APP_ENV',
        'NODE_ENV',
        'DATABASE_URL',
      ]);
    }
  });

  it('rejects documented local credentials in staging without echoing the URL', () => {
    const databaseUrl = 'postgresql://dartech:dartech@db.example.invalid:5432/dartech_os';

    expect(() =>
      loadWorkerConfig({
        APP_ENV: 'staging',
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        DATABASE_URL: databaseUrl,
      }),
    ).toThrowError(/DATABASE_URL/);

    try {
      loadWorkerConfig({
        APP_ENV: 'staging',
        NODE_ENV: 'production',
        DATABASE_URL: databaseUrl,
      });
    } catch (error: unknown) {
      expect((error as Error).message).not.toContain(databaseUrl);
      expect((error as Error).message).not.toContain('dartech:dartech');
    }
  });

  it('rejects a Node environment that conflicts with the deployment profile', () => {
    expect(() =>
      loadWorkerConfig({
        APP_ENV: 'production',
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://service:unique@db.example.invalid:5432/dartech_os',
      }),
    ).toThrowError(/NODE_ENV/);
  });

  it('loads bounded worker queue and retry defaults', () => {
    const config = loadWorkerConfig(validEnvironment);

    expect(config).toMatchObject({
      queueName: 'foundation',
      pollIntervalMs: 1000,
      leaseDurationMs: 30000,
      retryBaseDelayMs: 1000,
      retryMaxDelayMs: 60000,
      jobMaxAttempts: 5,
    });
    expect(config.workerId).toMatch(/^worker-\d+$/u);
  });

  it('rejects an invalid queue and inverted retry bounds', () => {
    expect(() =>
      loadWorkerConfig({
        ...validEnvironment,
        WORKER_QUEUE: 'Business Queue',
        WORKER_RETRY_BASE_DELAY_MS: '5000',
        WORKER_RETRY_MAX_DELAY_MS: '1000',
      }),
    ).toThrowError(/WORKER_QUEUE, WORKER_RETRY_MAX_DELAY_MS/);
  });
});
