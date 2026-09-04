import { Inject, Injectable, Optional } from '@nestjs/common';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import type {
  AuthorizationMetricsPort,
  AuthorizationResolverMetricsPort,
} from './authorization.contracts.js';

export interface AuthorizationMetricsRateLimitOptions {
  readonly windowMs?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export interface AuthorizationResolverMetricsRateLimitOptions {
  readonly windowMs?: number;
  readonly maxEmissionsPerWindow?: number;
  readonly now?: () => number;
}

interface RateLimitEntry {
  lastEmittedAt: number;
  count: number;
}

@Injectable()
export class StructuredAuthorizationMetricsAdapter implements AuthorizationMetricsPort {
  private readonly cache = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
    @Optional() options?: AuthorizationMetricsRateLimitOptions,
  ) {
    this.windowMs = options?.windowMs ?? 60_000;
    this.maxEntries = options?.maxEntries ?? 256;
    this.now = options?.now ?? (() => Date.now());
  }

  record(input: Parameters<AuthorizationMetricsPort['record']>[0]): void {
    try {
      const outcome = input.outcome === 'allowed' ? 'allowed' : 'denied';
      const reasonCode = input.reasonCode;
      const actionFamily =
        typeof input.actionFamily === 'string' && /^[a-z0-9_]+(\.[a-z0-9_]+)?$/.test(input.actionFamily)
          ? input.actionFamily
          : 'invalid';
      const scopeType = input.scopeType;

      const categoryKey = `${outcome}:${reasonCode}:${actionFamily}:${scopeType ?? 'none'}`;
      const currentTime = this.now();
      const existing = this.cache.get(categoryKey);

      if (existing && currentTime - existing.lastEmittedAt < this.windowMs) {
        existing.count += 1;
        return;
      }

      if (!existing && this.cache.size >= this.maxEntries) {
        this.pruneCache(currentTime);
      }

      this.cache.set(categoryKey, {
        lastEmittedAt: currentTime,
        count: 1,
      });

      this.logger.info('authorization.decision.metric', {
        outcome,
        reasonCode,
        actionFamily,
        ...(scopeType ? { scopeType } : {}),
      });
    } catch {
      // Observability is best-effort and must never throw or affect callers.
    }
  }

  private pruneCache(currentTime: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (currentTime - entry.lastEmittedAt >= this.windowMs) {
        this.cache.delete(key);
      }
    }
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
  }
}

@Injectable()
export class StructuredAuthorizationResolverMetricsAdapter
  implements AuthorizationResolverMetricsPort
{
  private readonly emittedCategories = new Set<string>();
  private readonly windowMs: number;
  private readonly maxEmissionsPerWindow: number;
  private readonly now: () => number;
  private windowStartedAt: number | undefined;
  private emissionCount = 0;

  constructor(
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
    @Optional() options?: AuthorizationResolverMetricsRateLimitOptions,
  ) {
    this.windowMs = this.positiveFiniteInteger(options?.windowMs, 60_000);
    this.maxEmissionsPerWindow = this.positiveFiniteInteger(
      options?.maxEmissionsPerWindow,
      128,
    );
    this.now = options?.now ?? (() => Date.now());
  }

  recordResolver(input: Parameters<AuthorizationResolverMetricsPort['recordResolver']>[0]): void {
    try {
      const currentTime = this.now();
      this.startNextWindowIfNeeded(currentTime);

      const categoryKey = `${input.scopeType}:${input.resourceType}:${input.outcome}:${input.latencyBucket}`;
      if (
        this.emissionCount >= this.maxEmissionsPerWindow ||
        this.emittedCategories.has(categoryKey)
      ) {
        return;
      }

      this.emittedCategories.add(categoryKey);
      this.emissionCount += 1;

      this.logger.info('authorization.scope_resolver.metric', {
        scopeType: input.scopeType,
        resourceType: input.resourceType,
        outcome: input.outcome,
        latencyBucket: input.latencyBucket,
      });
    } catch {
      // Observability is best-effort and must never throw or affect callers.
    }
  }

  private startNextWindowIfNeeded(currentTime: number): void {
    if (
      this.windowStartedAt === undefined ||
      currentTime < this.windowStartedAt ||
      currentTime - this.windowStartedAt >= this.windowMs
    ) {
      this.windowStartedAt = currentTime;
      this.emissionCount = 0;
      this.emittedCategories.clear();
    }
  }

  private positiveFiniteInteger(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1
      ? Math.floor(value)
      : fallback;
  }
}
