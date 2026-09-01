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

const apiEnvironmentSchema = databaseRuntimeSchema.safeExtend({
  API_PORT: portSchema.default(3001),
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
