import { Inject, Injectable } from "@nestjs/common";
import {
  STRUCTURED_LOGGER,
  type StructuredLogger,
} from "@dar-tech/observability";

const VALUES = [
  "active",
  "expiring",
  "expired",
  "revoked",
  "creation_failed",
] as const;
@Injectable()
export class TemporaryAccessMetrics {
  private windowStart = 0;
  private emitted = 0;
  private readonly seen = new Set<string>();
  constructor(
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}
  record(category: (typeof VALUES)[number], now = Date.now()): void {
    try {
      if (now - this.windowStart >= 60_000) {
        this.windowStart = now;
        this.emitted = 0;
        this.seen.clear();
      }
      if (
        !VALUES.includes(category) ||
        this.emitted >= 16 ||
        this.seen.has(category)
      )
        return;
      this.seen.add(category);
      this.emitted += 1;
      this.logger.info("temporary_access.metric", { category });
    } catch {
      /* Observability never changes authorization. */
    }
  }
}
