import type { DatabaseTransaction } from "@dar-tech/database";
import type {
  AuthorizationActor,
  AuthorizationResource,
} from "../authorization/authorization.contracts.js";
import type { EventRisk } from "../event-history/event-history.contracts.js";

export const APPROVAL_POLICY_OUTCOMES = [
  "NO_APPROVAL",
  "SINGLE_APPROVER",
  "SEQUENTIAL_APPROVAL",
  "PARALLEL_APPROVAL",
  "STEP_UP_ONLY",
  "STEP_UP_AND_APPROVAL",
] as const;
export type ApprovalPolicyOutcome = (typeof APPROVAL_POLICY_OUTCOMES)[number];
export type ApprovalApproverSubjectType = "EMPLOYEE" | "ROLE" | "RELATIONSHIP";
export type ApprovalSeparationRule = "NONE" | "REQUESTER_DIFFERENT_EMPLOYEE";

export interface ApprovalApproverSubject {
  readonly type: ApprovalApproverSubjectType;
  readonly key: string;
}

export interface ApprovalPolicyStep {
  readonly sequence: number;
  readonly approverSubject: ApprovalApproverSubject;
  readonly separationRule: ApprovalSeparationRule;
}

export interface StepUpRequirement {
  readonly assuranceLevel: string;
  readonly maximumAgeSeconds: number;
}

export interface ApprovalPolicy {
  readonly policyKey: string;
  readonly policyVersion: number;
  readonly outcome: ApprovalPolicyOutcome;
  readonly risk: EventRisk;
  readonly stepUpRequirement?: StepUpRequirement;
  readonly steps?: readonly ApprovalPolicyStep[];
}

export interface ApprovalPolicyResolverInput {
  readonly actor: AuthorizationActor;
  readonly action: string;
  readonly resource: AuthorizationResource;
  readonly risk: EventRisk;
  readonly context: Readonly<Record<string, string | number | boolean | null>>;
  readonly at: Date;
}

export interface ApprovalPolicyResolver {
  resolvePolicy(input: ApprovalPolicyResolverInput): Promise<unknown>;
}

export interface StepUpEvidenceEvaluator {
  evaluate(input: {
    readonly actor: AuthorizationActor;
    readonly requirement: StepUpRequirement;
    readonly at: Date;
  }): "SATISFIED" | "STEP_UP_REQUIRED";
}

export interface ApprovalApproverResolver {
  /** Resolve every server-created subject before persisting a request. No default bindings exist. */
  validatePlan(
    input: ApprovalPolicyResolverInput & {
      readonly policy: ValidatedApprovalPolicy;
      readonly transaction: DatabaseTransaction;
    },
  ): Promise<boolean>;
  actorMatches(input: {
    readonly actor: AuthorizationActor;
    readonly requesterEmployeeId: string;
    readonly subject: ApprovalApproverSubject;
    readonly separationRule: ApprovalSeparationRule;
    readonly action: string;
    readonly resource: {
      readonly type: string;
      readonly id: string | null;
      readonly organizationId: string;
    };
    readonly policyKey: string;
    readonly policyVersion: number;
    readonly context: Readonly<
      Record<string, string | number | boolean | null>
    >;
    readonly at: Date;
    readonly transaction?: DatabaseTransaction;
  }): Promise<boolean>;
}

export interface ApprovalReferenceEvidenceRepository {
  verify(input: {
    readonly actor: AuthorizationActor;
    readonly approvalReference: string;
    readonly action: string;
    readonly resource: AuthorizationResource;
    readonly risk: EventRisk;
    readonly policy: ValidatedApprovalPolicy;
    readonly contextFingerprint: string;
    readonly at: Date;
  }): Promise<boolean>;
}

export interface ValidatedApprovalPolicy extends ApprovalPolicy {
  readonly fingerprint: string;
  readonly steps: readonly ApprovalPolicyStep[];
}

export type ApprovalRequestStatus =
  | "DRAFT"
  | "PENDING"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "FAILED";
export type ApprovalExecutionState =
  "NOT_READY" | "READY" | "EXECUTING" | "SUCCEEDED" | "FAILED";
export type ApprovalStepStatus = "PENDING" | "APPROVED" | "REJECTED";
export interface ApprovalListFilters {
  readonly status?: Exclude<ApprovalRequestStatus, "DRAFT">;
  readonly risk?: EventRisk;
}

export interface ApprovalStepView {
  readonly id: string;
  readonly sequence: number;
  readonly status: ApprovalStepStatus;
  readonly decidedByEmployeeId: string | null;
  readonly safeDecisionReason: string | null;
  readonly decidedAt: Date | null;
  readonly version: number;
  readonly actionable: boolean;
  readonly canApprove: boolean;
  readonly canReject: boolean;
}

export interface ApprovalHistoryView {
  readonly id: string;
  readonly category: string;
  readonly requestStatus: ApprovalRequestStatus;
  readonly executionState: ApprovalExecutionState;
  readonly safeReason: string | null;
  readonly occurredAt: Date;
}

export interface ApprovalRequestView {
  readonly id: string;
  readonly organizationId: string;
  readonly requesterEmployeeId: string;
  readonly requesterSnapshot: Readonly<Record<string, unknown>>;
  readonly actionKey: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly resourceSnapshot: Readonly<Record<string, unknown>> | null;
  readonly risk: EventRisk;
  readonly policyOutcome: ApprovalPolicyOutcome;
  readonly status: ApprovalRequestStatus;
  readonly safeRequestReason: string | null;
  readonly executionState: ApprovalExecutionState;
  readonly executionResultReference: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly steps: readonly ApprovalStepView[];
  readonly history: readonly ApprovalHistoryView[];
}

export interface ApprovalPage {
  readonly items: readonly ApprovalRequestView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface PrepareApprovalInput {
  readonly actor: AuthorizationActor;
  readonly action: string;
  readonly resource: AuthorizationResource;
  readonly risk: EventRisk;
  readonly safeContext: Readonly<
    Record<string, string | number | boolean | null>
  >;
  readonly requesterSnapshot: Readonly<Record<string, string>>;
  readonly resourceSnapshot?: Readonly<Record<string, string>>;
  readonly safeReason?: string;
  readonly correlationId: string;
  readonly idempotencyMaterial: string;
  readonly at: Date;
}

export type PrepareApprovalResult =
  | {
      readonly outcome: "NO_APPROVAL" | "STEP_UP_SATISFIED";
      readonly policy: ValidatedApprovalPolicy;
    }
  | {
      readonly outcome: "STEP_UP_REQUIRED";
      readonly policy: ValidatedApprovalPolicy;
    }
  | {
      readonly outcome: "APPROVAL_REQUIRED";
      readonly request: ApprovalRequestView;
    };

export interface ApprovalRepositoryPort extends ApprovalReferenceEvidenceRepository {
  list(
    organizationId: string,
    page: number,
    pageSize: number,
    filters?: ApprovalListFilters,
  ): Promise<ApprovalPage>;
  findById(
    organizationId: string,
    id: string,
  ): Promise<ApprovalRequestView | null>;
  actionableStepIds(
    actor: AuthorizationActor,
    requestId: string,
    at: Date,
  ): Promise<readonly string[]>;
  prepare(
    input: PrepareApprovalInput,
    policy: ValidatedApprovalPolicy,
  ): Promise<ApprovalRequestView>;
  decide(input: {
    readonly actor: AuthorizationActor;
    readonly requestId: string;
    readonly stepId: string;
    readonly expectedVersion: number;
    readonly decision: "APPROVED" | "REJECTED";
    readonly safeReason: string | null;
    readonly correlationId: string;
    readonly at: Date;
  }): Promise<"changed" | "not_found" | "not_eligible" | "conflict">;
  claimExecution(
    input: ApprovalExecutionVerification,
    transaction?: DatabaseTransaction,
  ): Promise<ApprovalExecutionClaim>;
  completeExecution(
    input: ApprovalExecutionCompletion,
    transaction: DatabaseTransaction,
  ): Promise<void>;
  failExecution(
    input: ApprovalExecutionFailure,
    transaction: DatabaseTransaction,
  ): Promise<void>;
}

export interface ApprovalExecutionVerification {
  /** Non-mutating lookup only, used after current base authorization on a retry. */
  readonly replayOnly?: boolean;
  readonly actor: AuthorizationActor;
  readonly approvalReference: string;
  readonly action: string;
  readonly resource: AuthorizationResource;
  readonly risk: EventRisk;
  readonly policy: ValidatedApprovalPolicy;
  readonly contextFingerprint: string;
  readonly correlationId: string;
  readonly at: Date;
}
export type ApprovalExecutionClaim =
  | { readonly status: "claimed"; readonly claimVersion: number }
  | {
      readonly status: "already_succeeded";
      readonly resultReference: string | null;
    }
  | { readonly status: "denied" | "already_processing" };
export interface ApprovalExecutionCompletion {
  readonly claimVersion: number;
  readonly organizationId: string;
  readonly approvalReference: string;
  readonly resultReference: string;
  readonly correlationId: string;
  readonly at: Date;
}
export interface ApprovalExecutionFailure {
  readonly claimVersion: number;
  readonly organizationId: string;
  readonly approvalReference: string;
  readonly safeFailureCode: string;
  readonly correlationId: string;
  readonly at: Date;
}

export interface ApprovalExecutionLifecyclePort {
  claimApprovedAction(
    input: {
      readonly actor: AuthorizationActor;
      readonly approvalReference: string;
      readonly action: string;
      readonly resource: AuthorizationResource;
      readonly risk: EventRisk;
      readonly safeContext: Readonly<
        Record<string, string | number | boolean | null>
      >;
      readonly correlationId: string;
      readonly at: Date;
    },
    transaction?: DatabaseTransaction,
  ): Promise<ApprovalExecutionClaim>;
  completeApprovedAction(
    input: ApprovalExecutionCompletion,
    transaction: DatabaseTransaction,
  ): Promise<void>;
  failApprovedAction(
    input: ApprovalExecutionFailure,
    transaction: DatabaseTransaction,
  ): Promise<void>;
}

export const APPROVAL_POLICY_RESOLVER = Symbol("APPROVAL_POLICY_RESOLVER");
export const APPROVAL_APPROVER_RESOLVER = Symbol("APPROVAL_APPROVER_RESOLVER");
export const STEP_UP_EVIDENCE_EVALUATOR = Symbol("STEP_UP_EVIDENCE_EVALUATOR");
export const APPROVAL_REFERENCE_EVIDENCE_REPOSITORY = Symbol(
  "APPROVAL_REFERENCE_EVIDENCE_REPOSITORY",
);
export const APPROVAL_REPOSITORY_PORT = Symbol("APPROVAL_REPOSITORY_PORT");
export const APPROVAL_EXECUTION_LIFECYCLE_PORT = Symbol(
  "APPROVAL_EXECUTION_LIFECYCLE_PORT",
);
