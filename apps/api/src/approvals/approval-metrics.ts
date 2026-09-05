import { Inject, Injectable } from "@nestjs/common";
import {
  STRUCTURED_LOGGER,
  type StructuredLogger,
} from "@dar-tech/observability";
import { APPROVAL_POLICY_OUTCOMES } from "./approval.contracts.js";

const CATEGORIES = {
  pendingAgeBucket: ["under_hour", "under_day", "day_or_more"],
  decisionOutcome: ["changed", "not_found", "not_eligible", "conflict"],
  executionOutcome: [
    "claimed",
    "already_succeeded",
    "denied",
    "already_processing",
    "succeeded",
    "failed",
  ],
  executionFailureCategory: ["owning_mutation_failed", "dependency_failed"],
  policyResolutionOutcome: [
    ...APPROVAL_POLICY_OUTCOMES,
    "invalid",
    "unavailable",
  ],
  topologyType: APPROVAL_POLICY_OUTCOMES,
} as const;
export type ApprovalMetric = {
  readonly [K in keyof typeof CATEGORIES]?: (typeof CATEGORIES)[K][number];
};

/** Bounded dimensions, per-category suppression, and a hard per-window cap. */
@Injectable()
export class ApprovalMetrics {
  private windowStartedAt = 0;
  private emitted = 0;
  private readonly categories = new Set<string>();
  constructor(
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  record(metric: ApprovalMetric, now = Date.now()): void {
    try {
      if (now - this.windowStartedAt >= 60_000) {
        this.windowStartedAt = now;
        this.emitted = 0;
        this.categories.clear();
      }
      const bounded = Object.fromEntries(
        Object.entries(CATEGORIES).flatMap(([key, values]) => {
          const value: unknown = metric[key as keyof ApprovalMetric];
          return typeof value === "string" &&
            (values as readonly string[]).includes(value)
            ? [[key, value]]
            : [];
        }),
      );
      if (Object.keys(bounded).length === 0) return;
      const category = JSON.stringify(bounded);
      if (this.emitted >= 32 || this.categories.has(category)) return;
      this.categories.add(category);
      this.emitted += 1;
      this.logger.info("approval.metric", bounded);
    } catch {
      // Best-effort observability cannot affect approval behavior.
    }
  }
}
