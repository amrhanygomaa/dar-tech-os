import { describe, expect, it } from 'vitest';
import { REDACTED_VALUE, redactSensitiveValues, toSafeConfigSummary } from './safe-config.js';

describe('safe configuration output', () => {
  it('redacts nested secrets without mutating non-sensitive values', () => {
    expect(
      redactSensitiveValues({
        service: 'api',
        databaseUrl: 'postgresql://user:password@database/example',
        nested: {
          accessToken: 'secret-token',
          retries: 3,
        },
      }),
    ).toEqual({
      service: 'api',
      databaseUrl: REDACTED_VALUE,
      nested: {
        accessToken: REDACTED_VALUE,
        retries: 3,
      },
    });
  });

  it('exposes only a boolean for database configuration', () => {
    const summary = toSafeConfigSummary({
      runtime: 'worker',
      appEnvironment: 'development',
      nodeEnvironment: 'development',
      logLevel: 'info',
      databaseUrl: 'postgresql://user:password@database/example',
      databasePoolMax: 10,
      databaseConnectTimeoutMs: 5000,
      databaseIdleTimeoutMs: 30000,
      healthFile: null,
      heartbeatIntervalMs: 10000,
    });

    expect(summary).toEqual({
      runtime: 'worker',
      appEnvironment: 'development',
      nodeEnvironment: 'development',
      logLevel: 'info',
      databaseConfigured: true,
    });
    expect(JSON.stringify(summary)).not.toContain('password');
  });
});
