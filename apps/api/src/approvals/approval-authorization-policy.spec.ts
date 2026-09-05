import { describe, expect, it } from "vitest";
import type {
  AuthorizationActor,
  AuthorizationPolicyInput,
} from "../authorization/authorization.contracts.js";
import { ApprovalAuthorizationPolicyEvaluator } from "./approval-authorization-policy.js";
import { TrustedSessionStepUpEvidenceEvaluator } from "./approval-policy.js";

const at = new Date("2026-09-05T12:00:00.000Z");
const actor: AuthorizationActor = {
  actorType: "employee",
  sessionId: "trusted-session",
  organizationId: "organization-a",
  employeeId: "employee-a",
  userAccountId: "account-a",
  clientKind: "browser",
  assuranceLevel: "mfa",
  authenticatedAt: at,
  lastStepUpAt: at,
  issuedAt: at,
  lastSeenAt: at,
  idleExpiresAt: new Date(at.getTime() + 60_000),
  absoluteExpiresAt: new Date(at.getTime() + 600_000),
};
const input: AuthorizationPolicyInput = {
  actor,
  action: "admin.employee.suspend",
  resource: {
    type: "employee",
    organizationId: actor.organizationId,
    id: "employee-target",
  },
  context: { at, source: "application", approvalContext: { revision: 1 } },
  grant: {
    permissionKey: "admin.employee.suspend",
    riskClassification: "HIGH",
    scopeType: "ORGANIZATION",
    scopeBindingType: null,
    scopeBindingId: null,
  },
};
const step = {
  sequence: 1,
  approverSubject: { type: "ROLE" as const, key: "security.reviewer" },
  separationRule: "NONE" as const,
};

function evaluator(policy: unknown, evidence = true, trustedActor = actor) {
  return new ApprovalAuthorizationPolicyEvaluator(
    { resolvePolicy: async () => policy },
    new TrustedSessionStepUpEvidenceEvaluator({
      currentActor: () => trustedActor,
    } as never),
    { get: () => ({ verify: async () => evidence }) } as never,
  );
}

describe("ApprovalAuthorizationPolicyEvaluator", () => {
  it("preserves compatibility with explicit NO_APPROVAL", async () => {
    await expect(
      evaluator({
        policyKey: "compatibility.none",
        policyVersion: 1,
        outcome: "NO_APPROVAL",
        risk: "HIGH",
      }).evaluatePolicy(input),
    ).resolves.toEqual({ allowed: true });
  });
  it("requires step-up from the trusted actor and cannot use caller metadata", async () => {
    const policy = {
      policyKey: "test.step-up",
      policyVersion: 1,
      outcome: "STEP_UP_ONLY",
      risk: "HIGH",
      stepUpRequirement: { assuranceLevel: "mfa", maximumAgeSeconds: 60 },
    };
    await expect(
      evaluator(policy, true, { ...actor, lastStepUpAt: null }).evaluatePolicy(
        input,
      ),
    ).resolves.toEqual({ allowed: false, reasonCode: "STEP_UP_REQUIRED" });
  });
  it("requires an exact persisted approval reference", async () => {
    const policy = {
      policyKey: "test.approval",
      policyVersion: 1,
      outcome: "SINGLE_APPROVER",
      risk: "HIGH",
      steps: [step],
    };
    await expect(evaluator(policy).evaluatePolicy(input)).resolves.toEqual({
      allowed: false,
      reasonCode: "APPROVAL_REQUIRED",
    });
    await expect(
      evaluator(policy, false).evaluatePolicy({
        ...input,
        context: { ...input.context, approvalReference: "forged" },
      }),
    ).resolves.toEqual({
      allowed: false,
      reasonCode: "APPROVAL_INVALID_OR_STALE",
    });
    await expect(
      evaluator(policy, true).evaluatePolicy({
        ...input,
        context: { ...input.context, approvalReference: "exact" },
      }),
    ).resolves.toEqual({ allowed: true });
  });
  it("fails closed on resolver errors and malformed configured policy", async () => {
    await expect(
      evaluator({ outcome: "NO_APPROVAL" }).evaluatePolicy(input),
    ).resolves.toEqual({
      allowed: false,
      reasonCode: "AUTHORIZATION_DEPENDENCY_FAILED",
    });
    const throwing = new ApprovalAuthorizationPolicyEvaluator(
      {
        resolvePolicy: async () => {
          throw new Error("unavailable");
        },
      },
      new TrustedSessionStepUpEvidenceEvaluator({
        currentActor: () => actor,
      } as never),
      { get: () => ({ verify: async () => true }) } as never,
    );
    await expect(throwing.evaluatePolicy(input)).resolves.toEqual({
      allowed: false,
      reasonCode: "AUTHORIZATION_DEPENDENCY_FAILED",
    });
  });
});
