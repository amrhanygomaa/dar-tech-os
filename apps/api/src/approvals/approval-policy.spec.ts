import { describe, expect, it } from "vitest";
import type { AuthorizationActor } from "../authorization/authorization.contracts.js";
import {
  CompatibilityApprovalPolicyResolver,
  TrustedSessionStepUpEvidenceEvaluator,
  validateApprovalPolicy,
} from "./approval-policy.js";
import { AuthorizationActorContext } from "../authorization/authorization-context.js";
import { boundedApprovalPolicyInput } from "./approval-input.js";

const step = {
  sequence: 1,
  approverSubject: { type: "ROLE" as const, key: "security.reviewer" },
  separationRule: "REQUESTER_DIFFERENT_EMPLOYEE" as const,
};
const base = {
  policyKey: "test.policy",
  policyVersion: 1,
  risk: "HIGH" as const,
};
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
  lastStepUpAt: new Date(at.getTime() - 30_000),
  issuedAt: at,
  lastSeenAt: at,
  idleExpiresAt: new Date(at.getTime() + 60_000),
  absoluteExpiresAt: new Date(at.getTime() + 600_000),
};

describe("approval policy foundation", () => {
  it("projects only bounded resolver fields and rejects unsafe context or noncanonical risk", () => {
    const input = {
      actor: { ...actor, headers: { cookie: "private-fixture" } },
      action: "admin.employee.suspend",
      resource: {
        type: "employee" as const,
        organizationId: actor.organizationId,
        id: "target",
        rawBody: { secret: "private-fixture" },
      },
      risk: "HIGH" as const,
      context: { revision: 1 },
      at,
    };
    const bounded = boundedApprovalPolicyInput(input);
    expect(bounded.actor).not.toHaveProperty("headers");
    expect(bounded.resource).not.toHaveProperty("rawBody");
    expect(bounded.at).not.toBe(at);
    expect(() =>
      boundedApprovalPolicyInput({
        ...input,
        context: { accessToken: "private-fixture" },
      }),
    ).toThrow();
    expect(() =>
      boundedApprovalPolicyInput({ ...input, risk: "LOW" }),
    ).toThrow();
    expect(() =>
      boundedApprovalPolicyInput({
        ...input,
        context: { revision: "x".repeat(257) },
      }),
    ).toThrow();
  });
  it.each([
    { outcome: "NO_APPROVAL" },
    { outcome: "SINGLE_APPROVER", steps: [step] },
    {
      outcome: "SEQUENTIAL_APPROVAL",
      steps: [
        step,
        {
          ...step,
          sequence: 2,
          approverSubject: {
            type: "RELATIONSHIP" as const,
            key: "resource.owner",
          },
        },
      ],
    },
    {
      outcome: "PARALLEL_APPROVAL",
      steps: [
        step,
        {
          ...step,
          approverSubject: {
            type: "EMPLOYEE" as const,
            key: "employee.subject",
          },
        },
      ],
    },
    {
      outcome: "STEP_UP_ONLY",
      stepUpRequirement: { assuranceLevel: "mfa", maximumAgeSeconds: 300 },
    },
    {
      outcome: "STEP_UP_AND_APPROVAL",
      stepUpRequirement: { assuranceLevel: "mfa", maximumAgeSeconds: 300 },
      steps: [step],
    },
  ] as const)("validates canonical outcome $outcome", (policy) => {
    expect(
      validateApprovalPolicy({ ...base, ...policy }, "HIGH")?.outcome,
    ).toBe(policy.outcome);
  });

  it("fails closed for malformed topology, risk, separation, and step-up configuration", () => {
    expect(
      validateApprovalPolicy(
        { ...base, outcome: "SINGLE_APPROVER", steps: [] },
        "HIGH",
      ),
    ).toBeNull();
    expect(
      validateApprovalPolicy(
        { ...base, outcome: "PARALLEL_APPROVAL", steps: [step] },
        "HIGH",
      ),
    ).toBeNull();
    expect(
      validateApprovalPolicy(
        {
          ...base,
          outcome: "SEQUENTIAL_APPROVAL",
          steps: [step, { ...step, sequence: 3 }],
        },
        "HIGH",
      ),
    ).toBeNull();
    expect(
      validateApprovalPolicy({ ...base, outcome: "STEP_UP_ONLY" }, "HIGH"),
    ).toBeNull();
    expect(
      validateApprovalPolicy({ ...base, outcome: "NO_APPROVAL" }, "CRITICAL"),
    ).toBeNull();
    expect(
      validateApprovalPolicy(
        {
          ...base,
          outcome: "SINGLE_APPROVER",
          steps: [{ ...step, separationRule: undefined }],
        },
        "HIGH",
      ),
    ).toBeNull();
  });

  it("uses the explicit compatibility NO_APPROVAL policy only when the resolver succeeds", async () => {
    const resolved =
      await new CompatibilityApprovalPolicyResolver().resolvePolicy({
        actor,
        action: "admin.employee.read",
        resource: { type: "employee", organizationId: actor.organizationId },
        risk: "LOW",
        context: {},
        at,
      });
    expect(resolved).toEqual({
      policyKey: "compatibility.no-approval",
      policyVersion: 1,
      outcome: "NO_APPROVAL",
      risk: "LOW",
    });
  });

  it("evaluates only trusted session evidence with exact assurance and bounded freshness", () => {
    const context = new AuthorizationActorContext();
    const evaluator = new TrustedSessionStepUpEvidenceEvaluator(context);
    const requirement = { assuranceLevel: "mfa", maximumAgeSeconds: 60 };
    expect(evaluator.evaluate({ actor, requirement, at })).toBe(
      "STEP_UP_REQUIRED",
    );
    expect(
      context.run(actor, () => evaluator.evaluate({ actor, requirement, at })),
    ).toBe("SATISFIED");
    for (const trusted of [
      { ...actor, lastStepUpAt: null },
      { ...actor, lastStepUpAt: new Date(at.getTime() - 61_000) },
      { ...actor, assuranceLevel: "password" },
      { ...actor, idleExpiresAt: at },
      { ...actor, employeeId: "different" },
    ])
      expect(
        context.run(trusted, () =>
          evaluator.evaluate({ actor, requirement, at }),
        ),
      ).toBe("STEP_UP_REQUIRED");
  });

  it("rejects malformed shapes and duplicated required subjects without throwing", () => {
    for (const steps of [{ length: 1 }, "steps", 1, [step, step]]) {
      expect(
        validateApprovalPolicy(
          { ...base, outcome: "PARALLEL_APPROVAL", steps },
          "HIGH",
        ),
      ).toBeNull();
    }
    expect(
      validateApprovalPolicy(
        { ...base, outcome: "NO_APPROVAL", accessToken: "not-allowed" },
        "HIGH",
      ),
    ).toBeNull();
    expect(
      validateApprovalPolicy(
        {
          ...base,
          outcome: "SINGLE_APPROVER",
          steps: [
            {
              ...step,
              approverSubject: {
                type: "EMPLOYEE",
                key: "018f53d4-2f68-7c52-a399-3df2364df111",
              },
            },
          ],
        },
        "HIGH",
      ),
    ).not.toBeNull();
  });
});
