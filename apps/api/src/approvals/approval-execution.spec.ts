import { describe, expect, it, vi } from "vitest";
import type { AuthorizationActor } from "../authorization/authorization.contracts.js";
import { ApprovalService } from "./approval.service.js";

const at = new Date("2026-09-05T12:00:00.000Z");
const actor: AuthorizationActor = {
  actorType: "employee",
  sessionId: "session",
  organizationId: "organization",
  employeeId: "employee",
  userAccountId: "account",
  clientKind: "browser",
  assuranceLevel: "mfa",
  authenticatedAt: at,
  lastStepUpAt: at,
  issuedAt: at,
  lastSeenAt: at,
  idleExpiresAt: new Date(at.getTime() + 60_000),
  absoluteExpiresAt: new Date(at.getTime() + 600_000),
};
const policy = {
  policyKey: "test.execution",
  policyVersion: 1,
  outcome: "SINGLE_APPROVER",
  risk: "HIGH",
  steps: [
    {
      sequence: 1,
      approverSubject: { type: "ROLE", key: "security.reviewer" },
      separationRule: "NONE",
    },
  ],
};
const input = {
  actor,
  approvalReference: "approval-reference",
  action: "admin.employee.suspend",
  resource: {
    type: "employee" as const,
    organizationId: actor.organizationId,
    id: "target",
  },
  risk: "HIGH" as const,
  safeContext: { revision: 1 },
  correlationId: "correlation",
  at,
};

function service(allowed: boolean) {
  const authorize = vi.fn(async () => ({
    allowed,
    reasonCode: allowed ? "AUTHORIZED" : "PERMISSION_NOT_GRANTED",
    permissionKey: input.action,
  }));
  const claimExecution = vi.fn(async () => ({ status: "claimed" as const }));
  const instance = new ApprovalService(
    { currentActor: () => actor } as never,
    { authorize } as never,
    { now: () => at },
    { resolvePolicy: async () => policy },
    { evaluate: () => "SATISFIED" },
    { claimExecution } as never,
    { record: () => undefined } as never,
  );
  return { instance, authorize, claimExecution };
}

describe("approval execution lifecycle", () => {
  it("rechecks the central authorization service before claiming", async () => {
    const denied = service(false);
    await expect(denied.instance.claimApprovedAction(input)).resolves.toEqual({
      status: "denied",
    });
    expect(denied.authorize).toHaveBeenCalledWith(
      actor,
      input.action,
      input.resource,
      expect.objectContaining({
        approvalReference: input.approvalReference,
        approvalContext: input.safeContext,
      }),
    );
    expect(denied.claimExecution).not.toHaveBeenCalled();
  });

  it("passes exact current policy/context evidence to the concurrency-safe repository after reauthorization", async () => {
    const allowed = service(true);
    await expect(
      allowed.instance.claimApprovedAction({
        ...input,
        at: new Date("2099-01-01"),
      }),
    ).resolves.toEqual({
      status: "claimed",
    });
    expect(allowed.claimExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalReference: input.approvalReference,
        action: input.action,
        resource: input.resource,
        risk: input.risk,
        at,
        contextFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
      undefined,
    );
  });
});
