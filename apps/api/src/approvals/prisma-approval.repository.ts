import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  DATABASE_CLIENT,
  runInTransaction,
  type DatabaseClient,
  type DatabaseTransaction,
  type Prisma,
} from "@dar-tech/database";
import { persistOutboxEvent } from "@dar-tech/outbox";
import {
  AUDIT_ACTION_KEYS,
  AUDIT_EVENT_APPEND_PORT,
  type AuditEventAppendPort,
} from "../event-history/event-history.contracts.js";
import {
  APPROVAL_APPROVER_RESOLVER,
  type ApprovalApproverResolver,
  type ApprovalExecutionClaim,
  type ApprovalExecutionCompletion,
  type ApprovalExecutionFailure,
  type ApprovalExecutionVerification,
  type ApprovalPage,
  type ApprovalRepositoryPort,
  type ApprovalRequestView,
  type PrepareApprovalInput,
  type ValidatedApprovalPolicy,
} from "./approval.contracts.js";
import { APPROVAL_EVENTS } from "./approval.events.js";
import { approvalFingerprint } from "./approval-policy.js";
import {
  validApprovalSnapshot,
  validatePrepareApprovalInput,
} from "./approval-input.js";
import { AuthorizationService } from "../authorization/authorization.service.js";

const requestInclude = {
  steps: {
    orderBy: [{ sequence: "asc" as const }, { createdAt: "asc" as const }],
  },
  history: {
    orderBy: [{ occurredAt: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.ApprovalRequestInclude;
type RawRequest = Prisma.ApprovalRequestGetPayload<{
  include: typeof requestInclude;
}>;

function record(
  value: Prisma.JsonValue | null,
): Readonly<Record<string, unknown>> | null {
  return validApprovalSnapshot(value) ? value : null;
}

function requestView(request: RawRequest): ApprovalRequestView {
  return {
    id: request.id,
    organizationId: request.organizationId,
    requesterEmployeeId: request.requesterEmployeeId,
    requesterSnapshot: record(request.requesterSnapshot) ?? {},
    actionKey: request.actionKey,
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    resourceSnapshot: record(request.resourceSnapshot),
    risk: request.risk,
    policyOutcome: request.policyOutcome,
    status: request.status,
    safeRequestReason: request.safeRequestReason,
    executionState: request.executionState,
    executionResultReference: request.executionResultReference,
    version: request.version,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    steps: request.steps.map((step) => ({
      id: step.id,
      sequence: step.sequence,
      status: step.status,
      decidedByEmployeeId: step.decidedByEmployeeId,
      safeDecisionReason: step.safeDecisionReason,
      decidedAt: step.decidedAt,
      version: step.version,
      actionable: false,
      canApprove: false,
      canReject: false,
    })),
    history: request.history.map((entry) => ({
      id: entry.id,
      category: entry.category,
      requestStatus: entry.requestStatus,
      executionState: entry.executionState,
      safeReason: entry.safeReason,
      occurredAt: entry.occurredAt,
    })),
  };
}

function digest(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

@Injectable()
export class PrismaApprovalRepository implements ApprovalRepositoryPort {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(APPROVAL_APPROVER_RESOLVER)
    private readonly approvers: ApprovalApproverResolver,
    @Inject(AUDIT_EVENT_APPEND_PORT)
    private readonly audit: AuditEventAppendPort,
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
  ) {}

  async list(
    organizationId: string,
    page: number,
    pageSize: number,
    filters: NonNullable<Parameters<ApprovalRepositoryPort["list"]>[3]> = {},
  ): Promise<ApprovalPage> {
    const where = {
      organizationId,
      status: filters.status ?? { not: "DRAFT" as const },
      ...(filters.risk ? { risk: filters.risk } : {}),
    };
    const [total, requests] = await this.client.$transaction([
      this.client.approvalRequest.count({ where }),
      this.client.approvalRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: requestInclude,
      }),
    ]);
    return { items: requests.map(requestView), page, pageSize, total };
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<ApprovalRequestView | null> {
    const request = await this.client.approvalRequest.findFirst({
      where: { organizationId, id, status: { not: "DRAFT" } },
      include: requestInclude,
    });
    return request ? requestView(request) : null;
  }

  async actionableStepIds(
    actor: ApprovalExecutionVerification["actor"],
    requestId: string,
    at: Date,
  ): Promise<readonly string[]> {
    const request = await this.client.approvalRequest.findFirst({
      where: {
        id: requestId,
        organizationId: actor.organizationId,
        status: { in: ["PENDING", "IN_REVIEW"] },
      },
      include: { steps: true },
    });
    if (!request || !(await this.currentActor(actor, at, this.client)))
      return [];
    const pending = request.steps.filter((step) => step.status === "PENDING");
    if (pending.length === 0) return [];
    const sequence = Math.min(...pending.map((step) => step.sequence));
    const matches = await Promise.all(
      pending
        .filter((step) => step.sequence === sequence)
        .map(async (step) => ({
          id: step.id,
          eligible:
            (step.separationRule !== "REQUESTER_DIFFERENT_EMPLOYEE" ||
              actor.employeeId !== request.requesterEmployeeId) &&
            (await this.approvers.actorMatches({
              actor,
              requesterEmployeeId: request.requesterEmployeeId,
              subject: {
                type: step.approverSubjectType,
                key: step.approverSubjectKey,
              },
              separationRule: step.separationRule,
              ...this.resolverContext(request),
              at,
            })),
        })),
    );
    return matches.filter((match) => match.eligible).map((match) => match.id);
  }

  async prepare(
    input: PrepareApprovalInput,
    policy: ValidatedApprovalPolicy,
  ): Promise<ApprovalRequestView> {
    validatePrepareApprovalInput(input);
    const contextFingerprint = approvalFingerprint(input.safeContext);
    const idempotencyDigest = digest(
      input.actor.organizationId,
      input.actor.employeeId,
      input.action,
      input.resource.type,
      input.resource.id ?? "",
      input.idempotencyMaterial,
      contextFingerprint,
      policy.fingerprint,
    );
    try {
      return await runInTransaction(this.client, async (transaction) => {
        if (!(await this.currentActor(input.actor, input.at, transaction)))
          throw new Error("Approval actor is not current");
        const existing = await transaction.approvalRequest.findUnique({
          where: {
            organizationId_idempotencyDigest: {
              organizationId: input.actor.organizationId,
              idempotencyDigest,
            },
          },
          include: requestInclude,
        });
        if (existing) return requestView(existing);
        if (
          !(await this.approvers.validatePlan({
            actor: input.actor,
            action: input.action,
            resource: input.resource,
            risk: input.risk,
            context: input.safeContext,
            at: input.at,
            policy,
            transaction,
          }))
        )
          throw new Error("Approval plan is unavailable");
        const request = await transaction.approvalRequest.create({
          data: {
            organizationId: input.actor.organizationId,
            requesterEmployeeId: input.actor.employeeId,
            requesterSnapshot: input.requesterSnapshot as Prisma.InputJsonValue,
            actionKey: input.action,
            resourceType: input.resource.type,
            resourceId: input.resource.id ?? null,
            ...(input.resourceSnapshot
              ? {
                  resourceSnapshot:
                    input.resourceSnapshot as Prisma.InputJsonValue,
                }
              : {}),
            serverContextSnapshot: input.safeContext as Prisma.InputJsonValue,
            contextFingerprint,
            risk: input.risk,
            policyKey: policy.policyKey,
            policyVersion: policy.policyVersion,
            policyOutcome: policy.outcome,
            policyFingerprint: policy.fingerprint,
            stepUpAssuranceLevel:
              policy.stepUpRequirement?.assuranceLevel ?? null,
            stepUpMaxAgeSeconds:
              policy.stepUpRequirement?.maximumAgeSeconds ?? null,
            status: "PENDING",
            safeRequestReason: input.safeReason ?? null,
            correlationId: input.correlationId,
            idempotencyDigest,
            executionState: "NOT_READY",
            steps: {
              create: policy.steps.map((step) => ({
                organization: { connect: { id: input.actor.organizationId } },
                sequence: step.sequence,
                approverSubjectType: step.approverSubject.type,
                approverSubjectKey: step.approverSubject.key,
                separationRule: step.separationRule,
              })),
            },
            history: {
              create: {
                organization: { connect: { id: input.actor.organizationId } },
                actorEmployee: {
                  connect: {
                    organizationId_id: {
                      organizationId: input.actor.organizationId,
                      id: input.actor.employeeId,
                    },
                  },
                },
                category: "REQUESTED",
                requestStatus: "PENDING",
                executionState: "NOT_READY",
                ...(input.safeReason ? { safeReason: input.safeReason } : {}),
                correlationId: input.correlationId,
                occurredAt: input.at,
              },
            },
          },
          include: requestInclude,
        });
        await persistOutboxEvent(transaction, {
          ...APPROVAL_EVENTS.requested,
          organizationId: input.actor.organizationId,
          correlationId: input.correlationId,
          occurredAt: input.at,
          payload: {
            approvalReference: request.id,
            actionKey: request.actionKey,
            risk: request.risk,
            policyOutcome: request.policyOutcome,
          },
        });
        return requestView(request);
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        const existing = await this.client.approvalRequest.findUnique({
          where: {
            organizationId_idempotencyDigest: {
              organizationId: input.actor.organizationId,
              idempotencyDigest,
            },
          },
          include: requestInclude,
        });
        if (existing) return requestView(existing);
      }
      throw error;
    }
  }

  async decide(
    input: Parameters<ApprovalRepositoryPort["decide"]>[0],
  ): Promise<"changed" | "not_found" | "not_eligible" | "conflict"> {
    return runInTransaction(this.client, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM approval_requests WHERE id = ${input.requestId}::uuid AND organization_id = ${input.actor.organizationId}::uuid FOR UPDATE`;
      const request = await transaction.approvalRequest.findFirst({
        where: {
          id: input.requestId,
          organizationId: input.actor.organizationId,
        },
        include: { steps: true },
      });
      if (!request) return "not_found";
      if (!(await this.currentActor(input.actor, input.at, transaction)))
        return "not_eligible";
      const authorization = await this.authorization.authorize(
        input.actor,
        input.decision === "APPROVED"
          ? "approval.request.approve"
          : "approval.request.reject",
        {
          type: "approval-request",
          organizationId: request.organizationId,
          id: request.id,
        },
        { at: input.at, source: "application" },
      );
      if (!authorization.allowed) return "not_eligible";
      if (!["PENDING", "IN_REVIEW"].includes(request.status))
        return "not_eligible";
      const step = request.steps.find(
        (candidate) => candidate.id === input.stepId,
      );
      if (!step) return "not_found";
      const currentSequence = Math.min(
        ...request.steps
          .filter((candidate) => candidate.status === "PENDING")
          .map((candidate) => candidate.sequence),
      );
      if (step.status !== "PENDING" || step.sequence !== currentSequence)
        return "not_eligible";
      if (
        step.separationRule === "REQUESTER_DIFFERENT_EMPLOYEE" &&
        input.actor.employeeId === request.requesterEmployeeId
      )
        return "not_eligible";
      const eligible = await this.approvers.actorMatches({
        actor: input.actor,
        requesterEmployeeId: request.requesterEmployeeId,
        subject: {
          type: step.approverSubjectType,
          key: step.approverSubjectKey,
        },
        separationRule: step.separationRule,
        ...this.resolverContext(request),
        at: input.at,
        transaction,
      });
      if (!eligible) return "not_eligible";
      // Conflict details are visible only after current subject eligibility passes.
      if (step.version !== input.expectedVersion) return "conflict";
      const changed = await transaction.approvalStep.updateMany({
        where: {
          id: step.id,
          organizationId: input.actor.organizationId,
          status: "PENDING",
          version: input.expectedVersion,
        },
        data: {
          status: input.decision,
          decidedByEmployeeId: input.actor.employeeId,
          safeDecisionReason: input.safeReason,
          decidedAt: input.at,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) return "conflict";
      if (input.decision === "REJECTED") {
        await transaction.approvalRequest.update({
          where: { id: request.id },
          data: {
            status: "REJECTED",
            rejectedAt: input.at,
            version: { increment: 1 },
          },
        });
        await transaction.approvalHistoryEntry.create({
          data: {
            organizationId: request.organizationId,
            approvalRequestId: request.id,
            approvalStepId: step.id,
            actorEmployeeId: input.actor.employeeId,
            category: "REQUEST_REJECTED",
            requestStatus: "REJECTED",
            executionState: request.executionState,
            safeReason: input.safeReason,
            correlationId: input.correlationId,
            occurredAt: input.at,
          },
        });
        await this.outbox(
          transaction,
          APPROVAL_EVENTS.rejected,
          request,
          input.correlationId,
          input.at,
        );
      } else {
        await transaction.approvalHistoryEntry.create({
          data: {
            organizationId: request.organizationId,
            approvalRequestId: request.id,
            approvalStepId: step.id,
            actorEmployeeId: input.actor.employeeId,
            category: "STEP_APPROVED",
            requestStatus: "IN_REVIEW",
            executionState: request.executionState,
            safeReason: input.safeReason,
            correlationId: input.correlationId,
            occurredAt: input.at,
          },
        });
        await this.outbox(
          transaction,
          APPROVAL_EVENTS.stepApproved,
          request,
          input.correlationId,
          input.at,
        );
        const remaining = await transaction.approvalStep.count({
          where: {
            organizationId: request.organizationId,
            approvalRequestId: request.id,
            status: "PENDING",
          },
        });
        if (remaining === 0) {
          await transaction.approvalRequest.update({
            where: { id: request.id },
            data: {
              status: "APPROVED",
              executionState: "READY",
              approvedAt: input.at,
              version: { increment: 1 },
            },
          });
          await transaction.approvalHistoryEntry.create({
            data: {
              organizationId: request.organizationId,
              approvalRequestId: request.id,
              actorEmployeeId: input.actor.employeeId,
              category: "APPROVAL_COMPLETED",
              requestStatus: "APPROVED",
              executionState: "READY",
              correlationId: input.correlationId,
              occurredAt: input.at,
            },
          });
          await this.outbox(
            transaction,
            APPROVAL_EVENTS.completed,
            request,
            input.correlationId,
            input.at,
          );
        } else {
          await transaction.approvalRequest.update({
            where: { id: request.id },
            data: { status: "IN_REVIEW", version: { increment: 1 } },
          });
        }
      }
      await this.audit.append(
        {
          organizationId: request.organizationId,
          actionKey: AUDIT_ACTION_KEYS.approvalDecision,
          actorEmployeeId: input.actor.employeeId,
          actorSnapshot: { type: "employee" },
          targetType: "approval-request",
          targetId: request.id,
          ...(input.safeReason ? { safeReason: input.safeReason } : {}),
          approvalReference: request.id,
          correlationId: input.correlationId,
          occurredAt: input.at,
        },
        transaction,
      );
      return "changed";
    });
  }

  async verify(
    input: Parameters<ApprovalRepositoryPort["verify"]>[0],
  ): Promise<boolean> {
    if (
      input.resource.organizationId !== input.actor.organizationId ||
      !(await this.currentActor(
        input.actor,
        input.at,
        this.client,
        input.policy,
      ))
    )
      return false;
    const request = await this.client.approvalRequest.findFirst({
      where: {
        id: input.approvalReference,
        organizationId: input.actor.organizationId,
        requesterEmployeeId: input.actor.employeeId,
        status: "APPROVED",
        executionState: "READY",
        actionKey: input.action,
        resourceType: input.resource.type,
        resourceId: input.resource.id ?? null,
        risk: input.risk,
        policyKey: input.policy.policyKey,
        policyVersion: input.policy.policyVersion,
        policyFingerprint: input.policy.fingerprint,
        contextFingerprint: input.contextFingerprint,
      },
    });
    return !!request;
  }

  async claimExecution(
    input: ApprovalExecutionVerification,
    transaction?: DatabaseTransaction,
  ): Promise<ApprovalExecutionClaim> {
    const work = async (
      database: DatabaseTransaction,
    ): Promise<ApprovalExecutionClaim> => {
      const request = await database.approvalRequest.findFirst({
        where: {
          id: input.approvalReference,
          organizationId: input.actor.organizationId,
        },
      });
      if (
        !request ||
        input.resource.organizationId !== input.actor.organizationId ||
        !(await this.currentActor(
          input.actor,
          input.at,
          database,
          input.policy,
        ))
      )
        return { status: "denied" };
      const exact =
        request.requesterEmployeeId === input.actor.employeeId &&
        request.actionKey === input.action &&
        request.resourceType === input.resource.type &&
        request.resourceId === (input.resource.id ?? null) &&
        request.risk === input.risk &&
        request.policyKey === input.policy.policyKey &&
        request.policyVersion === input.policy.policyVersion &&
        request.policyFingerprint === input.policy.fingerprint &&
        request.contextFingerprint === input.contextFingerprint;
      if (!exact) return { status: "denied" };
      if (request.executionState === "SUCCEEDED")
        return {
          status: "already_succeeded",
          resultReference: request.executionResultReference,
        };
      if (request.executionState === "EXECUTING")
        return { status: "already_processing" };
      if (
        input.replayOnly ||
        request.status !== "APPROVED" ||
        request.executionState !== "READY"
      )
        return { status: "denied" };
      const authorization = await this.authorization.authorize(
        input.actor,
        input.action,
        input.resource,
        {
          at: input.at,
          source: "application",
          approvalReference: input.approvalReference,
          approvalContext:
            request.serverContextSnapshot as PrepareApprovalInput["safeContext"],
        },
      );
      if (!authorization.allowed) return { status: "denied" };
      const changed = await database.approvalRequest.updateMany({
        where: {
          id: request.id,
          organizationId: request.organizationId,
          status: "APPROVED",
          executionState: "READY",
          version: request.version,
        },
        data: { executionState: "EXECUTING", version: { increment: 1 } },
      });
      if (changed.count !== 1) return { status: "already_processing" };
      await database.approvalHistoryEntry.create({
        data: {
          organizationId: request.organizationId,
          approvalRequestId: request.id,
          actorEmployeeId: input.actor.employeeId,
          category: "EXECUTION_STARTED",
          requestStatus: "APPROVED",
          executionState: "EXECUTING",
          correlationId: input.correlationId,
          occurredAt: input.at,
        },
      });
      return { status: "claimed", claimVersion: request.version + 1 };
    };
    return transaction
      ? work(transaction)
      : runInTransaction(this.client, work);
  }

  completeExecution(
    input: ApprovalExecutionCompletion,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    return this.finishExecution(input, transaction, true);
  }
  failExecution(
    input: ApprovalExecutionFailure,
    transaction: DatabaseTransaction,
  ): Promise<void> {
    return this.finishExecution(input, transaction, false);
  }

  private async finishExecution(
    input: ApprovalExecutionCompletion | ApprovalExecutionFailure,
    transaction: DatabaseTransaction,
    succeeded: boolean,
  ): Promise<void> {
    const reference = succeeded
      ? (input as ApprovalExecutionCompletion).resultReference
      : (input as ApprovalExecutionFailure).safeFailureCode;
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(reference) ||
      !Number.isSafeInteger(input.claimVersion) ||
      input.claimVersion < 1
    )
      throw new Error("Invalid approval completion");
    await transaction.$queryRaw`SELECT id FROM approval_requests WHERE id = ${input.approvalReference}::uuid AND organization_id = ${input.organizationId}::uuid FOR UPDATE`;
    const request = await transaction.approvalRequest.findFirst({
      where: {
        id: input.approvalReference,
        organizationId: input.organizationId,
        executionState: "EXECUTING",
        version: input.claimVersion,
      },
    });
    if (!request) throw new Error("Approval execution state is not claimable");
    await transaction.approvalRequest.update({
      where: { id: request.id },
      data: succeeded
        ? {
            status: "EXECUTED",
            executionState: "SUCCEEDED",
            executionResultReference: (input as ApprovalExecutionCompletion)
              .resultReference,
            executedAt: input.at,
            version: { increment: 1 },
          }
        : {
            status: "FAILED",
            executionState: "FAILED",
            executionFailureCode: (input as ApprovalExecutionFailure)
              .safeFailureCode,
            failedAt: input.at,
            version: { increment: 1 },
          },
    });
    await transaction.approvalHistoryEntry.create({
      data: {
        organizationId: request.organizationId,
        approvalRequestId: request.id,
        category: succeeded ? "EXECUTION_SUCCEEDED" : "EXECUTION_FAILED",
        requestStatus: succeeded ? "EXECUTED" : "FAILED",
        executionState: succeeded ? "SUCCEEDED" : "FAILED",
        ...(!succeeded
          ? { safeReason: (input as ApprovalExecutionFailure).safeFailureCode }
          : {}),
        correlationId: input.correlationId,
        occurredAt: input.at,
      },
    });
    await this.outbox(
      transaction,
      succeeded ? APPROVAL_EVENTS.executed : APPROVAL_EVENTS.executionFailed,
      request,
      input.correlationId,
      input.at,
    );
    await this.audit.append(
      {
        organizationId: request.organizationId,
        actionKey: AUDIT_ACTION_KEYS.approvalExecution,
        actorSnapshot: { type: "system" },
        targetType: "approval-request",
        targetId: request.id,
        approvalReference: request.id,
        correlationId: input.correlationId,
        ...(!succeeded
          ? { safeReason: (input as ApprovalExecutionFailure).safeFailureCode }
          : {}),
        occurredAt: input.at,
      },
      transaction,
    );
  }

  private resolverContext(request: {
    actionKey: string;
    resourceType: string;
    resourceId: string | null;
    organizationId: string;
    policyKey: string;
    policyVersion: number;
    serverContextSnapshot: Prisma.JsonValue;
  }) {
    return {
      action: request.actionKey,
      resource: {
        type: request.resourceType,
        id: request.resourceId,
        organizationId: request.organizationId,
      },
      policyKey: request.policyKey,
      policyVersion: request.policyVersion,
      context:
        request.serverContextSnapshot as PrepareApprovalInput["safeContext"],
    };
  }

  private async currentActor(
    actor: PrepareApprovalInput["actor"],
    at: Date,
    database: DatabaseTransaction,
    policy?: ValidatedApprovalPolicy,
  ): Promise<boolean> {
    const session = await database.session.findFirst({
      where: {
        id: actor.sessionId,
        organizationId: actor.organizationId,
        employeeId: actor.employeeId,
        userAccountId: actor.userAccountId,
        revokedAt: null,
        idleExpiresAt: { gt: at },
        absoluteExpiresAt: { gt: at },
        employee: { lifecycleStatus: "ACTIVE" },
        userAccount: { authenticationEligible: true, disabledAt: null },
      },
      select: { assuranceLevel: true, lastStepUpAt: true },
    });
    if (!session) return false;
    if (!policy?.stepUpRequirement) return true;
    const age = session.lastStepUpAt
      ? at.getTime() - session.lastStepUpAt.getTime()
      : -1;
    return (
      session.assuranceLevel === policy.stepUpRequirement.assuranceLevel &&
      age >= 0 &&
      age <= policy.stepUpRequirement.maximumAgeSeconds * 1000
    );
  }

  private outbox(
    transaction: DatabaseTransaction,
    contract: { readonly eventType: string; readonly eventVersion: number },
    request: {
      readonly id: string;
      readonly organizationId: string;
      readonly actionKey: string;
      readonly risk: string;
    },
    correlationId: string,
    at: Date,
  ) {
    return persistOutboxEvent(transaction, {
      ...contract,
      organizationId: request.organizationId,
      correlationId,
      occurredAt: at,
      payload: {
        approvalReference: request.id,
        actionKey: request.actionKey,
        risk: request.risk,
      },
    });
  }
}
