import type { DestinationStream, Logger, LoggerOptions } from 'pino';
import pino from 'pino';
import type { LoggerService } from '@nestjs/common';
import { redactSensitiveValues } from '@dar-tech/config';
import type { AppEnvironment, LogLevel } from '@dar-tech/config';
import type { RuntimeName } from '@dar-tech/types';
import type { RequestContextStore } from './request-context.js';

export interface StructuredLoggerOptions {
  readonly runtime: RuntimeName;
  readonly environment: AppEnvironment;
  readonly level: LogLevel;
  readonly destination?: DestinationStream;
}

type LogFields = Readonly<Record<string, unknown>>;
const reservedLogFields = new Set([
  'correlationId',
  'environment',
  'event',
  'jobId',
  'level',
  'msg',
  'requestId',
  'runtime',
  'service',
  'time',
]);
const eventNamePattern = /^[a-z][a-z0-9]*(?:\.[a-z0-9_-]+)+$/u;

function safeEventName(value: string): string {
  return eventNamePattern.test(value) ? value : 'application.invalid_event';
}

function scrubText(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^:\s/@]+:[^@\s/]+@/giu, '$1[REDACTED]:[REDACTED]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, 'Bearer [REDACTED]')
    .replace(
      /\b(password|secret|token|authorization)\s*[:=]\s*[^\s,;]+/giu,
      '$1=[REDACTED]',
    )
    .slice(0, 2_048);
}

function scrubValues(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return scrubText(value);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Error) {
    return { name: value.name };
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubValues(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, scrubValues(nestedValue, seen)]),
  );
}

function safeFields(fields: LogFields): Record<string, unknown> {
  try {
    const redacted = redactSensitiveValues(scrubValues(fields));
    if (!redacted || typeof redacted !== 'object' || Array.isArray(redacted)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(redacted).filter(([key]) => !reservedLogFields.has(key)),
    );
  } catch {
    return { serialization: 'failed' };
  }
}

function normalizeNestLog(
  level: 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal',
  message: unknown,
  optionalParameters: readonly unknown[],
): {
  event: string;
  fields: LogFields;
} {
  if (message instanceof Error) {
    return { event: `application.${level}`, fields: { errorName: message.name } };
  }

  if (typeof message === 'string') {
    const possibleContext = optionalParameters.at(-1);
    const canUseContext = level !== 'error' || optionalParameters.length > 1;
    return {
      event: `application.${level}`,
      fields: {
        message: scrubText(message),
        ...(canUseContext && typeof possibleContext === 'string'
          ? { context: scrubText(possibleContext) }
          : {}),
      },
    };
  }

  return {
    event: `application.${level}`,
    fields: message && typeof message === 'object' ? (message as LogFields) : {},
  };
}

export class StructuredLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(
    private readonly contextStore: RequestContextStore,
    options: StructuredLoggerOptions,
  ) {
    const loggerOptions: LoggerOptions = {
      level: options.level,
      base: {
        service: 'dar-tech-os',
        runtime: options.runtime,
        environment: options.environment,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      mixin: () => {
        const context = this.contextStore.get();
        return context
          ? {
              ...(context.requestId ? { requestId: context.requestId } : {}),
              ...(context.jobId ? { jobId: context.jobId } : {}),
              correlationId: context.correlationId,
            }
          : {};
      },
    };

    this.logger = options.destination
      ? pino(loggerOptions, options.destination)
      : pino(loggerOptions);
  }

  info(event: string, fields: LogFields = {}): void {
    const safeEvent = safeEventName(event);
    this.logger.info({ ...safeFields(fields), event: safeEvent }, safeEvent);
  }

  warnEvent(event: string, fields: LogFields = {}): void {
    const safeEvent = safeEventName(event);
    this.logger.warn({ ...safeFields(fields), event: safeEvent }, safeEvent);
  }

  errorEvent(event: string, fields: LogFields = {}): void {
    const safeEvent = safeEventName(event);
    this.logger.error({ ...safeFields(fields), event: safeEvent }, safeEvent);
  }

  log(message: unknown, ...optionalParameters: unknown[]): void {
    const normalized = normalizeNestLog('log', message, optionalParameters);
    this.info(normalized.event, normalized.fields);
  }

  error(message: unknown, ...optionalParameters: unknown[]): void {
    const normalized = normalizeNestLog('error', message, optionalParameters);
    this.errorEvent(normalized.event, normalized.fields);
  }

  warn(message: unknown, ...optionalParameters: unknown[]): void {
    const normalized = normalizeNestLog('warn', message, optionalParameters);
    this.warnEvent(normalized.event, normalized.fields);
  }

  debug(message: unknown, ...optionalParameters: unknown[]): void {
    const normalized = normalizeNestLog('debug', message, optionalParameters);
    this.logger.debug({ ...safeFields(normalized.fields), event: normalized.event }, normalized.event);
  }

  verbose(message: unknown, ...optionalParameters: unknown[]): void {
    const normalized = normalizeNestLog('verbose', message, optionalParameters);
    this.logger.trace({ ...safeFields(normalized.fields), event: normalized.event }, normalized.event);
  }

  fatal(message: unknown, ...optionalParameters: unknown[]): void {
    const normalized = normalizeNestLog('fatal', message, optionalParameters);
    this.logger.fatal({ ...safeFields(normalized.fields), event: normalized.event }, normalized.event);
  }
}
