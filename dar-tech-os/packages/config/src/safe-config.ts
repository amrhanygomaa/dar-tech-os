import type { ApiConfig, WebConfig, WorkerConfig } from './runtime-config.js';

export const REDACTED_VALUE = '[REDACTED]' as const;

export const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /credential/i,
  /database.*url/i,
  /password/i,
  /secret/i,
  /token/i,
] as const;

export interface SafeConfigSummary {
  readonly runtime: 'api' | 'web' | 'worker';
  readonly appEnvironment: string;
  readonly nodeEnvironment: string;
  readonly logLevel: string;
  readonly port?: number;
  readonly databaseConfigured: boolean;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactSensitiveValues(value: unknown, key = ''): unknown {
  if (isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        redactSensitiveValues(nestedValue, nestedKey),
      ]),
    );
  }

  return value;
}

export function toSafeConfigSummary(
  config: ApiConfig | WebConfig | WorkerConfig,
): SafeConfigSummary {
  const port = 'port' in config ? { port: config.port } : {};
  return {
    runtime: config.runtime,
    appEnvironment: config.appEnvironment,
    nodeEnvironment: config.nodeEnvironment,
    logLevel: config.logLevel,
    ...port,
    databaseConfigured: 'databaseUrl' in config && config.databaseUrl.length > 0,
  };
}
