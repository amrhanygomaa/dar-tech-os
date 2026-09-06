import { Inject, Injectable } from '@nestjs/common';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import type { EventRisk } from '../event-history/event-history.contracts.js';

const CATEGORIES = ['requested', 'activation_success', 'activation_denied', 'active', 'used', 'revoked', 'expired'] as const;

@Injectable()
export class EmergencyAccessMetrics {
  private windowStart = 0;
  private emitted = 0;
  private readonly seen = new Set<string>();

  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger) {}

  record(category: (typeof CATEGORIES)[number], risk: EventRisk, now = Date.now()): void {
    try {
      if (now - this.windowStart >= 60_000) {
        this.windowStart = now;
        this.emitted = 0;
        this.seen.clear();
      }
      const key = `${category}:${risk}`;
      if (!CATEGORIES.includes(category) || this.emitted >= 32 || this.seen.has(key)) return;
      this.seen.add(key);
      this.emitted += 1;
      this.logger.info('emergency_access.metric', { category, risk });
    } catch {
      // Bounded observability is best-effort and cannot influence authorization.
    }
  }
}

@Injectable()
export class StructuredEmergencyAccessAlertHook {
  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger) {}

  notify(input: { readonly category: string; readonly risk: EventRisk; readonly outcome: string }): void {
    try {
      this.logger.info('emergency_access.alert', {
        category: input.category,
        risk: input.risk,
        outcome: input.outcome,
        priority: input.risk === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      });
    } catch {
      // Alert delivery adapters never create or extend authority.
    }
  }
}
