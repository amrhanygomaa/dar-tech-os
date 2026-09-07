import { Inject, Injectable } from '@nestjs/common';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import type { OffboardingMetricsPort } from './offboarding.contracts.js';

@Injectable()
export class OffboardingMetrics implements OffboardingMetricsPort {
  private windowStart = 0;
  private emitted = 0;
  private readonly seen = new Set<string>();

  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger) {}

  record(input: Parameters<OffboardingMetricsPort['record']>[0], now = Date.now()): void {
    try {
      if (now - this.windowStart >= 60_000) {
        this.windowStart = now;
        this.emitted = 0;
        this.seen.clear();
      }
      const key = `${input.operation}:${input.outcome}:${input.category ?? 'none'}`;
      if (this.emitted >= 24 || this.seen.has(key)) return;
      this.seen.add(key);
      this.emitted += 1;
      if (input.outcome === 'incomplete') {
        this.logger.errorEvent('employee_offboarding.incomplete_alert', input);
      } else {
        this.logger.info('employee_lifecycle.metric', input);
      }
    } catch {
      // Observability cannot create authority or change lifecycle safety.
    }
  }
}
