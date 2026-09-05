import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { DatabaseTransaction } from "@dar-tech/database";
import { AuthorizationActorContext } from "../authorization/authorization-context.js";
import {
  AUTHORIZATION_CLOCK,
  type AuthorizationClock,
} from "../authorization/authorization.contracts.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import {
  APPROVAL_POLICY_RESOLVER,
  APPROVAL_REPOSITORY_PORT,
  STEP_UP_EVIDENCE_EVALUATOR,
  type ApprovalPage,
  type ApprovalExecutionClaim,
  type ApprovalExecutionCompletion,
  type ApprovalExecutionFailure,
  type ApprovalExecutionLifecyclePort,
  type ApprovalPolicyResolver,
  type ApprovalRepositoryPort,
  type ApprovalRequestView,
  type PrepareApprovalInput,
  type PrepareApprovalResult,
  type StepUpEvidenceEvaluator,
} from "./approval.contracts.js";
import {
  approvalConflict,
  approvalDenied,
  approvalNotFound,
  approvalPolicyUnavailable,
  approvalAuthenticationRequired,
} from "./approval.errors.js";
import {
  parseApprovalDecision,
  parseApprovalId,
  parseApprovalPagination,
  parseApprovalFilters,
  validateApprovalPolicyInput,
  boundedApprovalPolicyInput,
  validatePrepareApprovalInput,
} from "./approval-input.js";
import {
  approvalFingerprint,
  validateApprovalPolicy,
} from "./approval-policy.js";
import { ApprovalMetrics } from "./approval-metrics.js";

@Injectable()
export class ApprovalService implements ApprovalExecutionLifecyclePort {
  constructor(
    @Inject(AuthorizationActorContext)
    private readonly actors: AuthorizationActorContext,
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
    @Inject(AUTHORIZATION_CLOCK) private readonly clock: AuthorizationClock,
    @Inject(APPROVAL_POLICY_RESOLVER)
    private readonly policies: ApprovalPolicyResolver,
    @Inject(STEP_UP_EVIDENCE_EVALUATOR)
    private readonly stepUp: StepUpEvidenceEvaluator,
    @Inject(APPROVAL_REPOSITORY_PORT)
    private readonly repository: ApprovalRepositoryPort,
    @Inject(ApprovalMetrics) private readonly metrics: ApprovalMetrics,
  ) {}

  async list(
    pageInput?: string,
    pageSizeInput?: string,
    status?: string,
    risk?: string,
  ): Promise<ApprovalPage> {
    const actor = this.requireActor();
    const { page, pageSize } = parseApprovalPagination(
      pageInput,
      pageSizeInput,
    );
    const filters = parseApprovalFilters(status, risk);
    const authorization = await this.authorization.authorize(
      actor,
      "approval.request.read",
      { type: "approval-request", organizationId: actor.organizationId },
      { at: this.clock.now(), source: "http" },
    );
    // No extension resolver may turn a collection match into authority over every row.
    // Scoped readers use exact detail IDs until a typed authorized-list query exists.
    if (
      !authorization.allowed ||
      authorization.matchedGrant?.scopeType !== "ORGANIZATION"
    )
      throw approvalDenied();
    const result = await this.repository.list(
      actor.organizationId,
      page,
      pageSize,
      filters,
    );
    return {
      ...result,
      items: await Promise.all(
        result.items.map((request) => this.withActionable(actor, request)),
      ),
    };
  }

  async detail(idInput: string): Promise<ApprovalRequestView> {
    const actor = this.requireActor();
    const id = parseApprovalId(idInput);
    await this.requireAuthorization(actor, "approval.request.read", id);
    const request = await this.repository.findById(actor.organizationId, id);
    if (!request) throw approvalNotFound();
    return this.withActionable(actor, request);
  }

  approve(id: string, body: unknown): Promise<ApprovalRequestView> {
    return this.decide(id, body, "APPROVED");
  }
  reject(id: string, body: unknown): Promise<ApprovalRequestView> {
    return this.decide(id, body, "REJECTED");
  }

  /** Internal application port. No HTTP controller exposes request creation. */
  async prepareApprovalForAction(
    input: PrepareApprovalInput,
  ): Promise<PrepareApprovalResult> {
    input = {
      ...input,
      actor: this.trustedActor(input.actor),
      at: this.clock.now(),
    };
    validatePrepareApprovalInput(input);
    // A preparation result never grants authority to execute. Central policy may report
    // only the missing approval/step-up evidence after current permission and scope pass.
    const authorization = await this.authorization.authorize(
      input.actor,
      input.action,
      input.resource,
      {
        at: input.at,
        source: "application",
        approvalContext: input.safeContext,
      },
    );
    if (
      !authorization.allowed &&
      !["APPROVAL_REQUIRED", "STEP_UP_REQUIRED"].includes(
        authorization.reasonCode,
      )
    )
      throw approvalDenied();
    let raw: unknown;
    try {
      raw = await this.policies.resolvePolicy(
        boundedApprovalPolicyInput({
          actor: input.actor,
          action: input.action,
          resource: input.resource,
          risk: input.risk,
          context: input.safeContext,
          at: input.at,
        }),
      );
    } catch {
      this.metrics.record({ policyResolutionOutcome: "unavailable" });
      throw approvalPolicyUnavailable();
    }
    const policy = validateApprovalPolicy(raw, input.risk);
    if (!policy) {
      this.metrics.record({ policyResolutionOutcome: "invalid" });
      throw approvalPolicyUnavailable();
    }
    this.metrics.record({
      policyResolutionOutcome: policy.outcome,
      topologyType: policy.outcome,
    });
    if (policy.outcome === "NO_APPROVAL")
      return { outcome: "NO_APPROVAL", policy };
    if (
      policy.stepUpRequirement &&
      this.stepUp.evaluate({
        actor: input.actor,
        requirement: policy.stepUpRequirement,
        at: input.at,
      }) !== "SATISFIED"
    )
      return { outcome: "STEP_UP_REQUIRED", policy };
    if (policy.outcome === "STEP_UP_ONLY")
      return { outcome: "STEP_UP_SATISFIED", policy };
    return {
      outcome: "APPROVAL_REQUIRED",
      request: await this.repository.prepare(input, policy),
    };
  }

  async claimApprovedAction(
    input: Parameters<ApprovalExecutionLifecyclePort["claimApprovedAction"]>[0],
    transaction?: DatabaseTransaction,
  ): Promise<ApprovalExecutionClaim> {
    try {
      input = {
        ...input,
        actor: this.trustedActor(input.actor),
        at: this.clock.now(),
      };
      validateApprovalPolicyInput({ ...input, context: input.safeContext });
      const policy = validateApprovalPolicy(
        await this.policies.resolvePolicy(
          boundedApprovalPolicyInput({
            actor: input.actor,
            action: input.action,
            resource: input.resource,
            risk: input.risk,
            context: input.safeContext,
            at: input.at,
          }),
        ),
        input.risk,
      );
      if (!policy) return { status: "denied" };
      const authorization = await this.authorization.authorize(
        input.actor,
        input.action,
        input.resource,
        {
          at: input.at,
          source: "application",
          approvalReference: input.approvalReference,
          approvalContext: input.safeContext,
        },
      );
      let replayOnly = false;
      if (!authorization.allowed) {
        if (authorization.reasonCode !== "APPROVAL_INVALID_OR_STALE")
          return { status: "denied" };
        const base = await this.authorization.authorize(
          input.actor,
          input.action,
          input.resource,
          {
            at: input.at,
            source: "application",
            approvalContext: input.safeContext,
          },
        );
        if (base.reasonCode !== "APPROVAL_REQUIRED")
          return { status: "denied" };
        // This path can return an exact prior result, but cannot claim or execute anything.
        replayOnly = true;
      }
      const result = await this.repository.claimExecution(
        {
          actor: input.actor,
          approvalReference: input.approvalReference,
          action: input.action,
          resource: input.resource,
          risk: input.risk,
          policy,
          contextFingerprint: approvalFingerprint(input.safeContext),
          correlationId: input.correlationId,
          at: input.at,
          replayOnly,
        },
        transaction,
      );
      this.metrics.record({ executionOutcome: result.status });
      return result;
    } catch {
      return { status: "denied" };
    }
  }

  async completeApprovedAction(
    input: ApprovalExecutionCompletion,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.repository.completeExecution(input, transaction);
    this.metrics.record({ executionOutcome: "succeeded" });
  }
  async failApprovedAction(
    input: ApprovalExecutionFailure,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    await this.repository.failExecution(input, transaction);
    this.metrics.record({
      executionOutcome: "failed",
      executionFailureCategory: "owning_mutation_failed",
    });
  }

  private async decide(
    idInput: string,
    body: unknown,
    decision: "APPROVED" | "REJECTED",
  ): Promise<ApprovalRequestView> {
    const actor = this.requireActor();
    const requestId = parseApprovalId(idInput);
    const input = parseApprovalDecision(body);
    await this.requireAuthorization(
      actor,
      decision === "APPROVED"
        ? "approval.request.approve"
        : "approval.request.reject",
      requestId,
    );
    const result = await this.repository.decide({
      actor,
      requestId,
      stepId: input.stepId,
      expectedVersion: input.expectedVersion,
      decision,
      safeReason: input.reason,
      correlationId: randomUUID(),
      at: this.clock.now(),
    });
    this.metrics.record({ decisionOutcome: result });
    if (result === "conflict") throw approvalConflict();
    if (result !== "changed") throw approvalNotFound();
    const request = await this.repository.findById(
      actor.organizationId,
      requestId,
    );
    if (!request) throw approvalNotFound();
    return this.withActionable(actor, request);
  }

  private requireActor() {
    const actor = this.actors.currentActor();
    if (!actor) throw approvalAuthenticationRequired();
    return actor;
  }

  private trustedActor(supplied: PrepareApprovalInput["actor"]) {
    const actor = this.requireActor();
    if (
      actor.organizationId !== supplied.organizationId ||
      actor.employeeId !== supplied.employeeId ||
      actor.userAccountId !== supplied.userAccountId ||
      actor.sessionId !== supplied.sessionId ||
      actor.idleExpiresAt <= this.clock.now() ||
      actor.absoluteExpiresAt <= this.clock.now()
    )
      throw approvalAuthenticationRequired();
    return actor;
  }

  private async withActionable(
    actor: NonNullable<ReturnType<AuthorizationActorContext["currentActor"]>>,
    request: ApprovalRequestView,
  ): Promise<ApprovalRequestView> {
    const at = this.clock.now();
    if (["PENDING", "IN_REVIEW"].includes(request.status)) {
      const age = at.getTime() - request.createdAt.getTime();
      this.metrics.record({
        pendingAgeBucket:
          age < 3_600_000
            ? "under_hour"
            : age < 86_400_000
              ? "under_day"
              : "day_or_more",
      });
    }
    const resource = {
      type: "approval-request" as const,
      organizationId: actor.organizationId,
      id: request.id,
    };
    const [approve, reject] = await Promise.all([
      this.authorization.authorize(
        actor,
        "approval.request.approve",
        resource,
        { at, source: "http" },
      ),
      this.authorization.authorize(actor, "approval.request.reject", resource, {
        at,
        source: "http",
      }),
    ]);
    const actionable = new Set(
      await this.repository.actionableStepIds(
        actor,
        request.id,
        this.clock.now(),
      ),
    );
    return {
      ...request,
      steps: request.steps.map((step) => ({
        ...step,
        actionable:
          actionable.has(step.id) && (approve.allowed || reject.allowed),
        canApprove: actionable.has(step.id) && approve.allowed,
        canReject: actionable.has(step.id) && reject.allowed,
      })),
    };
  }

  private async requireAuthorization(
    actor: NonNullable<ReturnType<AuthorizationActorContext["currentActor"]>>,
    action: string,
    id?: string,
  ): Promise<void> {
    const result = await this.authorization.authorize(
      actor,
      action,
      {
        type: "approval-request",
        organizationId: actor.organizationId,
        ...(id ? { id } : {}),
      },
      { at: this.clock.now(), source: "http" },
    );
    if (!result.allowed) throw approvalDenied(result.reasonCode);
  }
}
