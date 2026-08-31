import { z } from 'zod';

const appEnvironmentSchema = z.enum(['development', 'test', 'staging', 'production']);
const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']);
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
const portSchema = z.coerce.number().int().min(1).max(65_535);
const positiveIntegerSchema = z.coerce.number().int().positive();

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

const workerEnvironmentSchema = databaseRuntimeSchema;

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
