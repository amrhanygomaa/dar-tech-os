import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadApiConfig, loadWorkerConfig } from './runtime-config.js';

const validEnvironment: NodeJS.ProcessEnv = {
  APP_ENV: 'development',
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://dartech:dartech@localhost:5432/dartech_os',
  INVITATION_TTL_SECONDS: '86400',
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
      authentication: {
        allowedRedirectUris: [],
        localProviderEnabled: false,
        localIdentities: [],
        transactionTtlSeconds: 300,
      },
      invitation: {
        ttlSeconds: 86400,
        rateLimitMaxRequests: 30,
        rateLimitWindowSeconds: 60,
      },
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

  it('requires an explicit invitation lifetime and validates its bounds', () => {
    expect(() =>
      loadApiConfig({ ...validEnvironment, INVITATION_TTL_SECONDS: undefined }),
    ).toThrowError(/INVITATION_TTL_SECONDS/);
    expect(() =>
      loadApiConfig({ ...validEnvironment, INVITATION_TTL_SECONDS: '59' }),
    ).toThrowError(/INVITATION_TTL_SECONDS/);
    expect(loadApiConfig(validEnvironment).invitation.ttlSeconds).toBe(86_400);
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

  it('loads an explicitly enabled local provider only for development', () => {
    const config = loadApiConfig({
      ...validEnvironment,
      AUTH_ALLOWED_REDIRECT_URIS: 'http://localhost:3000/auth/callback',
      AUTH_LOCAL_PROVIDER_ENABLED: 'true',
      AUTH_LOCAL_IDENTITIES_JSON: JSON.stringify([
        {
          loginHint: 'developer',
          providerSubject: 'local-subject',
          verifiedEmail: 'DEVELOPER@EXAMPLE.COM',
        },
      ]),
    });

    expect(config.authentication).toEqual({
      allowedRedirectUris: ['http://localhost:3000/auth/callback'],
      localProviderEnabled: true,
      localIdentities: [
        {
          loginHint: 'developer',
          providerSubject: 'local-subject',
          verifiedEmail: 'developer@example.com',
        },
      ],
      transactionTtlSeconds: 300,
    });
  });

  it.each(['staging', 'production'] as const)(
    'fails startup when local authentication is enabled in %s',
    (appEnvironment) => {
      expect(() =>
        loadApiConfig({
          ...validEnvironment,
          APP_ENV: appEnvironment,
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://service:unique@db.example.invalid:5432/dartech_os',
          AUTH_ALLOWED_REDIRECT_URIS: 'https://portal.example.invalid/auth/callback',
          AUTH_LOCAL_PROVIDER_ENABLED: 'true',
        }),
      ).toThrowError(/AUTH_LOCAL_PROVIDER_ENABLED/);
    },
  );

  it('permits explicitly enabled local authentication in the test profile', () => {
    expect(
      loadApiConfig({
        ...validEnvironment,
        APP_ENV: 'test',
        NODE_ENV: 'test',
        AUTH_ALLOWED_REDIRECT_URIS: 'http://localhost:3000/auth/callback',
        AUTH_LOCAL_PROVIDER_ENABLED: 'true',
      }).authentication.localProviderEnabled,
    ).toBe(true);
  });

  it('requires explicit redirect and identity configuration for development local auth', () => {
    expect(() =>
      loadApiConfig({
        ...validEnvironment,
        AUTH_LOCAL_PROVIDER_ENABLED: 'true',
      }),
    ).toThrowError(/AUTH_ALLOWED_REDIRECT_URIS, AUTH_LOCAL_IDENTITIES_JSON/);
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
