import { z } from 'zod';

const appEnvironmentSchema = z.enum(['development', 'test', 'staging', 'production']);
const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']);
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
const portSchema = z.coerce.number().int().min(1).max(65_535);
const positiveIntegerSchema = z.coerce.number().int().positive();
const workerIdentifierSchema = z
  .string()
  .trim()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
  .or(z.literal(''));
const queueNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9._-]*$/u);
const booleanStringSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
const localAuthenticationIdentitiesSchema = z
  .string()
  .trim()
  .default('[]')
  .transform((value, context) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: 'must be valid JSON' });
      return z.NEVER;
    }
  })
  .pipe(
    z.array(
      z
        .object({
          loginHint: z.string().trim().min(1).max(160),
          providerSubject: z.string().trim().min(1).max(255),
          verifiedEmail: z.string().trim().email().max(320).optional(),
        })
        .strict(),
    ).max(100),
  );
const redirectAllowlistSchema = z
  .string()
  .trim()
  .default('')
  .transform((value, context) => {
    const redirects = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const uniqueRedirects = [...new Set(redirects)];
    for (const redirect of uniqueRedirects) {
      try {
        const parsed = new URL(redirect);
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.username.length > 0 ||
          parsed.password.length > 0 ||
          parsed.hash.length > 0
        ) {
          throw new Error('unsafe redirect');
        }
      } catch {
        context.addIssue({ code: 'custom', message: 'must contain safe absolute HTTP(S) URLs' });
        return z.NEVER;
      }
    }
    return uniqueRedirects;
  });

const databaseUrlSchema = z.string().min(1).superRefine((value, context) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      context.addIssue({
        code: 'custom',
        message: 'must use the PostgreSQL protocol',
      });
    }
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'must be a valid PostgreSQL connection URL',
    });
  }
});

const commonRuntimeSchema = z
  .object({
    APP_ENV: appEnvironmentSchema,
    NODE_ENV: nodeEnvironmentSchema,
    LOG_LEVEL: logLevelSchema.default('info'),
  })
  .superRefine((value, context) => {
    const requiredNodeEnvironment =
      value.APP_ENV === 'staging' || value.APP_ENV === 'production'
        ? 'production'
        : value.APP_ENV;

    if (value.NODE_ENV !== requiredNodeEnvironment) {
      context.addIssue({
        code: 'custom',
        path: ['NODE_ENV'],
        message: `must be ${requiredNodeEnvironment} when APP_ENV is ${value.APP_ENV}`,
      });
    }
  });

const databaseRuntimeSchema = commonRuntimeSchema
  .safeExtend({
    DATABASE_URL: databaseUrlSchema,
    DATABASE_POOL_MAX: positiveIntegerSchema.max(100).default(10),
    DATABASE_CONNECT_TIMEOUT_MS: positiveIntegerSchema.max(60_000).default(5_000),
    DATABASE_IDLE_TIMEOUT_MS: positiveIntegerSchema.max(300_000).default(30_000),
  })
  .superRefine((value, context) => {
    if (value.APP_ENV !== 'staging' && value.APP_ENV !== 'production') {
      return;
    }

    const parsed = new URL(value.DATABASE_URL);
    if (parsed.username === 'dartech' && parsed.password === 'dartech') {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'must not use the documented local-development credentials',
      });
    }
  });

const apiEnvironmentSchema = databaseRuntimeSchema
  .safeExtend({
    API_PORT: portSchema.default(3001),
    AUTH_ALLOWED_REDIRECT_URIS: redirectAllowlistSchema,
    AUTH_LOCAL_IDENTITIES_JSON: localAuthenticationIdentitiesSchema,
    AUTH_LOCAL_PROVIDER_ENABLED: booleanStringSchema,
    AUTH_TRANSACTION_TTL_SECONDS: positiveIntegerSchema.min(60).max(900).default(300),
  })
  .superRefine((value, context) => {
    if (
      value.AUTH_LOCAL_PROVIDER_ENABLED &&
      (value.APP_ENV === 'staging' || value.APP_ENV === 'production')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_LOCAL_PROVIDER_ENABLED'],
        message: 'must be false in staging and production',
      });
    }

    if (value.AUTH_LOCAL_PROVIDER_ENABLED && value.AUTH_ALLOWED_REDIRECT_URIS.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_ALLOWED_REDIRECT_URIS'],
        message: 'must contain at least one URI when local authentication is enabled',
      });
    }

    if (
      value.AUTH_LOCAL_PROVIDER_ENABLED &&
      value.APP_ENV === 'development' &&
      value.AUTH_LOCAL_IDENTITIES_JSON.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_LOCAL_IDENTITIES_JSON'],
        message: 'must contain at least one identity in development',
      });
    }

    const localLoginHints = value.AUTH_LOCAL_IDENTITIES_JSON.map(({ loginHint }) => loginHint);
    const localSubjects = value.AUTH_LOCAL_IDENTITIES_JSON.map(
      ({ providerSubject }) => providerSubject,
    );
    if (new Set(localLoginHints).size !== localLoginHints.length) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_LOCAL_IDENTITIES_JSON'],
        message: 'must not contain duplicate login hints',
      });
    }
    if (new Set(localSubjects).size !== localSubjects.length) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_LOCAL_IDENTITIES_JSON'],
        message: 'must not contain duplicate provider subjects',
      });
    }
  });

const workerEnvironmentSchema = databaseRuntimeSchema
  .safeExtend({
    WORKER_HEALTH_FILE: z.string().trim().default(''),
    WORKER_HEARTBEAT_INTERVAL_MS: positiveIntegerSchema
      .min(1_000)
      .max(60_000)
      .default(10_000),
    WORKER_ID: workerIdentifierSchema.default(''),
    WORKER_QUEUE: queueNameSchema.default('foundation'),
    WORKER_POLL_INTERVAL_MS: positiveIntegerSchema.min(100).max(60_000).default(1_000),
    WORKER_LEASE_DURATION_MS: positiveIntegerSchema
      .min(1_000)
      .max(3_600_000)
      .default(30_000),
    WORKER_RETRY_BASE_DELAY_MS: positiveIntegerSchema
      .min(100)
      .max(86_400_000)
      .default(1_000),
    WORKER_RETRY_MAX_DELAY_MS: positiveIntegerSchema
      .min(100)
      .max(86_400_000)
      .default(60_000),
    WORKER_JOB_MAX_ATTEMPTS: positiveIntegerSchema.max(25).default(5),
  })
  .superRefine((value, context) => {
    if (value.WORKER_RETRY_MAX_DELAY_MS < value.WORKER_RETRY_BASE_DELAY_MS) {
      context.addIssue({
        code: 'custom',
        path: ['WORKER_RETRY_MAX_DELAY_MS'],
        message: 'must be greater than or equal to WORKER_RETRY_BASE_DELAY_MS',
      });
    }
  });

const webEnvironmentSchema = commonRuntimeSchema.safeExtend({
  WEB_PORT: portSchema.default(3000),
});

export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;

export interface ApiConfig {
  readonly runtime: 'api';
  readonly appEnvironment: AppEnvironment;
  readonly nodeEnvironment: 'development' | 'test' | 'production';
  readonly logLevel: LogLevel;
  readonly port: number;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly databaseConnectTimeoutMs: number;
  readonly databaseIdleTimeoutMs: number;
  readonly authentication: AuthenticationConfig;
}

export interface LocalAuthenticationIdentityConfig {
  readonly loginHint: string;
  readonly providerSubject: string;
  readonly verifiedEmail?: string;
}

export interface AuthenticationConfig {
  readonly allowedRedirectUris: readonly string[];
  readonly localProviderEnabled: boolean;
  readonly localIdentities: readonly LocalAuthenticationIdentityConfig[];
  readonly transactionTtlSeconds: number;
}

export interface WorkerConfig {
  readonly runtime: 'worker';
  readonly appEnvironment: AppEnvironment;
  readonly nodeEnvironment: 'development' | 'test' | 'production';
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly databaseConnectTimeoutMs: number;
  readonly databaseIdleTimeoutMs: number;
  readonly healthFile: string | null;
  readonly heartbeatIntervalMs: number;
  readonly workerId: string;
  readonly queueName: string;
  readonly pollIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly retryBaseDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly jobMaxAttempts: number;
}

export interface WebConfig {
  readonly runtime: 'web';
  readonly appEnvironment: AppEnvironment;
  readonly nodeEnvironment: 'development' | 'test' | 'production';
  readonly logLevel: LogLevel;
  readonly port: number;
}

export class ConfigValidationError extends Error {
  readonly fields: readonly string[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    const fields = [...new Set(issues.map((issue) => issue.path.join('.') || 'environment'))];
    super(`Invalid environment configuration: ${fields.join(', ')}`);
    this.name = 'ConfigValidationError';
    this.fields = fields;
  }
}

function parseEnvironment<T>(schema: z.ZodType<T>, environment: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(environment);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }

  return result.data;
}

export function loadApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const parsed = parseEnvironment(apiEnvironmentSchema, environment);
  return {
    runtime: 'api',
    appEnvironment: parsed.APP_ENV,
    nodeEnvironment: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    port: parsed.API_PORT,
    databaseUrl: parsed.DATABASE_URL,
    databasePoolMax: parsed.DATABASE_POOL_MAX,
    databaseConnectTimeoutMs: parsed.DATABASE_CONNECT_TIMEOUT_MS,
    databaseIdleTimeoutMs: parsed.DATABASE_IDLE_TIMEOUT_MS,
    authentication: {
      allowedRedirectUris: parsed.AUTH_ALLOWED_REDIRECT_URIS,
      localProviderEnabled: parsed.AUTH_LOCAL_PROVIDER_ENABLED,
      localIdentities: parsed.AUTH_LOCAL_IDENTITIES_JSON.map((identity) => ({
        loginHint: identity.loginHint,
        providerSubject: identity.providerSubject,
        ...(identity.verifiedEmail
          ? { verifiedEmail: identity.verifiedEmail.toLowerCase() }
          : {}),
      })),
      transactionTtlSeconds: parsed.AUTH_TRANSACTION_TTL_SECONDS,
    },
  };
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = parseEnvironment(workerEnvironmentSchema, environment);
  return {
    runtime: 'worker',
    appEnvironment: parsed.APP_ENV,
    nodeEnvironment: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    databasePoolMax: parsed.DATABASE_POOL_MAX,
    databaseConnectTimeoutMs: parsed.DATABASE_CONNECT_TIMEOUT_MS,
    databaseIdleTimeoutMs: parsed.DATABASE_IDLE_TIMEOUT_MS,
    healthFile: parsed.WORKER_HEALTH_FILE || null,
    heartbeatIntervalMs: parsed.WORKER_HEARTBEAT_INTERVAL_MS,
    workerId: parsed.WORKER_ID || `worker-${process.pid}`,
    queueName: parsed.WORKER_QUEUE,
    pollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
    leaseDurationMs: parsed.WORKER_LEASE_DURATION_MS,
    retryBaseDelayMs: parsed.WORKER_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: parsed.WORKER_RETRY_MAX_DELAY_MS,
    jobMaxAttempts: parsed.WORKER_JOB_MAX_ATTEMPTS,
  };
}

export function loadWebConfig(environment: NodeJS.ProcessEnv): WebConfig {
  const parsed = parseEnvironment(webEnvironmentSchema, environment);
  return {
    runtime: 'web',
    appEnvironment: parsed.APP_ENV,
    nodeEnvironment: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    port: parsed.WEB_PORT,
  };
}
