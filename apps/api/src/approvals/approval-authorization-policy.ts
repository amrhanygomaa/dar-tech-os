import { Inject, Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type {
  AuthorizationPolicyEvaluator,
  AuthorizationPolicyInput,
  AuthorizationPolicyResult,
} from "../authorization/authorization.contracts.js";
import {
  APPROVAL_POLICY_RESOLVER,
  APPROVAL_REFERENCE_EVIDENCE_REPOSITORY,
  STEP_UP_EVIDENCE_EVALUATOR,
  type ApprovalPolicyResolver,
  type ApprovalReferenceEvidenceRepository,
  type StepUpEvidenceEvaluator,
} from "./approval.contracts.js";
import {
  approvalFingerprint,
  validateApprovalPolicy,
} from "./approval-policy.js";
import { boundedApprovalPolicyInput } from "./approval-input.js";
import { ApprovalMetrics, type ApprovalMetric } from "./approval-metrics.js";

@Injectable()
export class ApprovalAuthorizationPolicyEvaluator implements AuthorizationPolicyEvaluator {
  constructor(
    @Inject(APPROVAL_POLICY_RESOLVER)
    private readonly resolver: ApprovalPolicyResolver,
    @Inject(STEP_UP_EVIDENCE_EVALUATOR)
    private readonly stepUp: StepUpEvidenceEvaluator,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  async evaluatePolicy(
    input: AuthorizationPolicyInput,
  ): Promise<AuthorizationPolicyResult> {
    const serverContext = input.context.approvalContext ?? {};
    try {
      const policyInput = {
        actor: input.actor,
        action: input.action,
        resource: input.resource,
        risk: input.grant.riskClassification,
        context: serverContext,
        at: input.context.at,
      };
      const raw = await this.resolver.resolvePolicy(
        boundedApprovalPolicyInput(policyInput),
      );
      const policy = validateApprovalPolicy(
        raw,
        input.grant.riskClassification,
      );
      if (!policy) {
        this.record({ policyResolutionOutcome: "invalid" });
        return {
          allowed: false,
          reasonCode: "AUTHORIZATION_DEPENDENCY_FAILED",
        };
      }
      this.record({
        policyResolutionOutcome: policy.outcome,
        topologyType: policy.outcome,
      });
      if (policy.outcome === "NO_APPROVAL") return { allowed: true };
      if (
        policy.stepUpRequirement &&
        this.stepUp.evaluate({
          actor: input.actor,
          requirement: policy.stepUpRequirement,
          at: input.context.at,
        }) !== "SATISFIED"
      ) {
        return { allowed: false, reasonCode: "STEP_UP_REQUIRED" };
      }
      if (policy.outcome === "STEP_UP_ONLY") return { allowed: true };
      if (!input.context.approvalReference)
        return { allowed: false, reasonCode: "APPROVAL_REQUIRED" };
      const evidence = this.moduleRef.get<ApprovalReferenceEvidenceRepository>(
        APPROVAL_REFERENCE_EVIDENCE_REPOSITORY,
        { strict: false },
      );
      const valid = await evidence.verify({
        actor: input.actor,
        approvalReference: input.context.approvalReference,
        action: input.action,
        resource: input.resource,
        risk: input.grant.riskClassification,
        policy,
        contextFingerprint: approvalFingerprint(serverContext),
        at: input.context.at,
      });
      return valid
        ? { allowed: true }
        : { allowed: false, reasonCode: "APPROVAL_INVALID_OR_STALE" };
    } catch {
      this.record({ policyResolutionOutcome: "unavailable" });
      return { allowed: false, reasonCode: "AUTHORIZATION_DEPENDENCY_FAILED" };
    }
  }

  private record(metric: ApprovalMetric): void {
    try {
      this.moduleRef
        .get<ApprovalMetrics>(ApprovalMetrics, { strict: false })
        .record(metric);
    } catch {
      /* Missing/failed observability cannot influence authorization. */
    }
  }
}
