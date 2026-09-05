import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuthorizationActorContext } from "../authorization/authorization-context.js";
import { EVENT_RISKS } from "../event-history/event-history.contracts.js";
import {
  APPROVAL_POLICY_OUTCOMES,
  type ApprovalApproverResolver,
  type ApprovalPolicy,
  type ApprovalPolicyResolver,
  type ApprovalPolicyResolverInput,
  type ApprovalPolicyStep,
  type StepUpEvidenceEvaluator,
  type ValidatedApprovalPolicy,
} from "./approval.contracts.js";

const KEY = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const ASSURANCE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function approvalFingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function validStep(value: unknown): value is ApprovalPolicyStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  const subject = step.approverSubject as Record<string, unknown> | undefined;
  return (
    Number.isInteger(step.sequence) &&
    Number(step.sequence) > 0 &&
    Number(step.sequence) <= 100 &&
    !!subject &&
    ["EMPLOYEE", "ROLE", "RELATIONSHIP"].includes(String(subject.type)) &&
    typeof subject.key === "string" &&
    subject.key.length <= 160 &&
    ASSURANCE.test(subject.key) &&
    ["NONE", "REQUESTER_DIFFERENT_EMPLOYEE"].includes(
      String(step.separationRule),
    )
  );
}

export function validateApprovalPolicy(
  value: unknown,
  expectedRisk: string,
): ValidatedApprovalPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "policyKey",
          "policyVersion",
          "outcome",
          "risk",
          "stepUpRequirement",
          "steps",
        ].includes(key),
    )
  )
    return null;
  const policy = value as ApprovalPolicy;
  if (
    typeof policy.policyKey !== "string" ||
    policy.policyKey.length > 160 ||
    !KEY.test(policy.policyKey) ||
    !Number.isInteger(policy.policyVersion) ||
    policy.policyVersion < 1 ||
    policy.policyVersion > 1_000_000 ||
    !APPROVAL_POLICY_OUTCOMES.includes(policy.outcome) ||
    !EVENT_RISKS.includes(policy.risk) ||
    policy.risk !== expectedRisk
  )
    return null;
  const requiresStepUp =
    policy.outcome === "STEP_UP_ONLY" ||
    policy.outcome === "STEP_UP_AND_APPROVAL";
  const requirement = policy.stepUpRequirement;
  if (requiresStepUp !== !!requirement) return null;
  if (
    requirement &&
    (typeof requirement.assuranceLevel !== "string" ||
      requirement.assuranceLevel.length > 80 ||
      !ASSURANCE.test(requirement.assuranceLevel) ||
      !Number.isInteger(requirement.maximumAgeSeconds) ||
      requirement.maximumAgeSeconds < 1 ||
      requirement.maximumAgeSeconds > 86_400)
  )
    return null;
  const requiresApproval = [
    "SINGLE_APPROVER",
    "SEQUENTIAL_APPROVAL",
    "PARALLEL_APPROVAL",
    "STEP_UP_AND_APPROVAL",
  ].includes(policy.outcome);
  const steps = policy.steps ?? [];
  if (
    !Array.isArray(steps) ||
    steps.length > 100 ||
    requiresApproval !== steps.length > 0 ||
    !steps.every(validStep)
  )
    return null;
  if (
    new Set(
      steps.map(
        (step) =>
          `${step.sequence}:${step.approverSubject.type}:${step.approverSubject.key}`,
      ),
    ).size !== steps.length
  )
    return null;
  const sequences = [...new Set(steps.map((step) => step.sequence))].sort(
    (a, b) => a - b,
  );
  if (sequences.some((sequence, index) => sequence !== index + 1)) return null;
  if (
    policy.outcome === "SINGLE_APPROVER" &&
    (steps.length !== 1 || steps[0]?.sequence !== 1)
  )
    return null;
  if (
    policy.outcome === "PARALLEL_APPROVAL" &&
    (steps.length < 2 || sequences.length !== 1 || sequences[0] !== 1)
  )
    return null;
  if (policy.outcome === "SEQUENTIAL_APPROVAL" && sequences.length < 1)
    return null;
  const normalized: ApprovalPolicy & {
    readonly steps: readonly ApprovalPolicyStep[];
  } = {
    policyKey: policy.policyKey,
    policyVersion: policy.policyVersion,
    outcome: policy.outcome,
    risk: policy.risk,
    ...(requirement
      ? {
          stepUpRequirement: {
            assuranceLevel: requirement.assuranceLevel,
            maximumAgeSeconds: requirement.maximumAgeSeconds,
          },
        }
      : {}),
    steps: steps.map((step) => ({
      sequence: step.sequence,
      approverSubject: {
        type: step.approverSubject.type,
        key: step.approverSubject.key,
      },
      separationRule: step.separationRule,
    })),
  };
  return { ...normalized, fingerprint: approvalFingerprint(normalized) };
}

/** Compatibility default only; it is not a business approval matrix. */
@Injectable()
export class CompatibilityApprovalPolicyResolver implements ApprovalPolicyResolver {
  resolvePolicy(input: ApprovalPolicyResolverInput): Promise<ApprovalPolicy> {
    return Promise.resolve({
      policyKey: "compatibility.no-approval",
      policyVersion: 1,
      outcome: "NO_APPROVAL",
      risk: input.risk,
    });
  }
}

@Injectable()
export class TrustedSessionStepUpEvidenceEvaluator implements StepUpEvidenceEvaluator {
  constructor(
    @Inject(AuthorizationActorContext)
    private readonly actors: AuthorizationActorContext,
  ) {}

  evaluate(
    input: Parameters<StepUpEvidenceEvaluator["evaluate"]>[0],
  ): "SATISFIED" | "STEP_UP_REQUIRED" {
    const { requirement, at } = input;
    const actor = this.actors.currentActor();
    if (
      !actor ||
      actor.sessionId !== input.actor.sessionId ||
      actor.employeeId !== input.actor.employeeId ||
      actor.userAccountId !== input.actor.userAccountId ||
      actor.organizationId !== input.actor.organizationId ||
      actor.idleExpiresAt <= at ||
      actor.absoluteExpiresAt <= at
    )
      return "STEP_UP_REQUIRED";
    if (
      actor.assuranceLevel !== requirement.assuranceLevel ||
      !actor.lastStepUpAt
    )
      return "STEP_UP_REQUIRED";
    const age = at.getTime() - actor.lastStepUpAt.getTime();
    return age >= 0 && age <= requirement.maximumAgeSeconds * 1000
      ? "SATISFIED"
      : "STEP_UP_REQUIRED";
  }
}

/** No production approver binding is installed by T09. */
@Injectable()
export class DenyAllApprovalApproverResolver implements ApprovalApproverResolver {
  validatePlan(): Promise<boolean> {
    return Promise.resolve(false);
  }
  actorMatches(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
