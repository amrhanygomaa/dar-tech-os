import { describe, expect, it, vi } from "vitest";
import { ApprovalMetrics } from "./approval-metrics.js";
import { APPROVAL_POLICY_OUTCOMES } from "./approval.contracts.js";

describe("ApprovalMetrics", () => {
  it("suppresses repeated categories, caps diverse churn, resets by window, and swallows logger failure", () => {
    const info = vi.fn();
    const metrics = new ApprovalMetrics({
      info,
      errorEvent: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as never);
    metrics.record({ decisionOutcome: "changed" }, 1);
    metrics.record({ decisionOutcome: "changed" }, 2);
    metrics.record({ decisionOutcome: "conflict" }, 3);
    for (let index = 0; index < 3; index += 1)
      for (const policy of APPROVAL_POLICY_OUTCOMES)
        for (const topology of APPROVAL_POLICY_OUTCOMES) {
          metrics.record(
            { policyResolutionOutcome: policy, topologyType: topology },
            4 + index,
          );
        }
    expect(info).toHaveBeenCalledTimes(32);
    expect(
      (metrics as unknown as { categories: Set<string> }).categories.size,
    ).toBeLessThanOrEqual(32);
    expect(JSON.stringify(info.mock.calls)).not.toMatch(
      /employeeId|sessionId|resourceId|roleId|email|correlationId/u,
    );
    metrics.record({ decisionOutcome: "changed" }, 60_001);
    expect(info).toHaveBeenCalledTimes(33);
    info.mockImplementationOnce(() => {
      throw new Error("logger unavailable");
    });
    expect(() =>
      metrics.record({ decisionOutcome: "not_eligible" }, 60_002),
    ).not.toThrow();
  });

  it("drops all unknown keys and values rather than truncating sensitive labels", () => {
    const info = vi.fn();
    const metrics = new ApprovalMetrics({ info } as never);
    metrics.record(
      {
        employeeId: "private",
        decisionOutcome: "employee-private",
        pendingAgeBucket: "under_hour",
      } as never,
      1,
    );
    expect(info).toHaveBeenCalledExactlyOnceWith("approval.metric", {
      pendingAgeBucket: "under_hour",
    });
  });
});
