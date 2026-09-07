import type { EmergencyAccessConfig } from '@dar-tech/config';
import type { DatabaseTransaction } from '@dar-tech/database';
import type {
  AuthorizationActor,
  AuthorizationDecision,
  AuthorizationResource,
  AuthorizationResourceType,
} from '../authorization/authorization.contracts.js';
import type { ValidatedApprovalPolicy } from '../approvals/approval.contracts.js';
import type { EventRisk } from '../event-history/event-history.contracts.js';
import type { ScopeType } from '../permissions/permission.contracts.js';

export const EMERGENCY_ACCESS_CONFIG = Symbol('EMERGENCY_ACCESS_CONFIG');
export const EMERGENCY_ACCESS_REPOSITORY = Symbol('EMERGENCY_ACCESS_REPOSITORY');
export const EMERGENCY_ACCESS_ALERT_HOOK = Symbol('EMERGENCY_ACCESS_ALERT_HOOK');

export type EmergencyAccessStoredStatus =
  | 'PENDING_APPROVAL'
  | 'ACTIVATION_ELIGIBLE'
  | 'ACTIVE'
  | 'DENIED'
  | 'REVOKED'
  | 'EXPIRED';

export interface EmergencyAccessBindingInput {
  readonly permissionKey: string;
  readonly scopeType: Exclude<ScopeType, 'SELF'>;
  readonly resourceType: AuthorizationResourceType;
  readonly resourceId: string | null;
}

export interface EmergencyAccessBindingView extends EmergencyAccessBindingInput {
  readonly id: string;
  readonly riskClassification: EventRisk;
}

export interface EmergencyAccessHistoryView {
  readonly eventType: string;
  readonly outcome: string;
  readonly risk: EventRisk;
  readonly action: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly occurredAt: Date;
}

export interface EmergencyAccessGrantView {
  readonly id: string;
  readonly organizationId: string;
  readonly requesterEmployeeId: string;
  readonly recipientEmployeeId: string;
  readonly requesterSnapshot: Readonly<Record<string, string>>;
  readonly recipientSnapshot: Readonly<Record<string, string>>;
  readonly reason: string;
  readonly requestedRisk: EventRisk;
  readonly effectiveRisk: EventRisk;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly activatedAt: Date | null;
  readonly storedStatus: EmergencyAccessStoredStatus;
  readonly status: EmergencyAccessStoredStatus;
  readonly approvalReference: string | null;
  readonly approvalStatus: string | null;
  readonly approvalExecutionState: string | null;
  readonly policyKey: string;
  readonly policyVersion: number;
  readonly policyFingerprint: string;
  readonly contextFingerprint: string;
  readonly stepUpAssuranceLevel: string;
  readonly stepUpVerifiedAt: Date;
  readonly denialCode: string | null;
  readonly deniedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokedByEmployeeId: string | null;
  readonly bindings: readonly EmergencyAccessBindingView[];
  readonly history: readonly EmergencyAccessHistoryView[];
  readonly canActivate: boolean;
  readonly canRevoke: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface EmergencyAccessPage {
  readonly items: readonly EmergencyAccessGrantView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface EmergencyAccessSubject {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly displayName: string;
  readonly employeeCode: string;
  readonly active: boolean;
}

export interface EmergencyAccessCreateData {
  readonly id: string;
  readonly actor: AuthorizationActor;
  readonly requester: EmergencyAccessSubject;
  readonly recipient: EmergencyAccessSubject;
  readonly reason: string;
  readonly requestedRisk: EventRisk;
  readonly effectiveRisk: EventRisk;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly bindings: readonly (EmergencyAccessBindingInput & {
    readonly riskClassification: EventRisk;
  })[];
  readonly policy: ValidatedApprovalPolicy;
  readonly stepUpVerifiedAt: Date;
  readonly idempotencyDigest: string;
  readonly requestFingerprint: string;
  readonly contextFingerprint: string;
  readonly approvalReference: string | null;
  readonly correlationId: string;
  readonly at: Date;
}

export interface EmergencyAccessRepositoryPort {
  transaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
  lockIdempotency(transaction: DatabaseTransaction, digest: string): Promise<void>;
  findSubject(
    organizationId: string,
    employeeId: string,
    transaction?: DatabaseTransaction,
  ): Promise<EmergencyAccessSubject | null>;
  findByIdempotency(
    organizationId: string,
    digest: string,
    at: Date,
    transaction?: DatabaseTransaction,
  ): Promise<EmergencyAccessGrantView | null>;
  create(input: EmergencyAccessCreateData, transaction: DatabaseTransaction): Promise<EmergencyAccessGrantView>;
  activate(input: {
    readonly organizationId: string;
    readonly id: string;
    readonly actorEmployeeId: string;
    readonly approvalReference: string | null;
    readonly correlationId: string;
    readonly stepUpVerifiedAt: Date;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<{ readonly outcome: 'activated' | 'idempotent'; readonly grant: EmergencyAccessGrantView }>;
  recordDenied(input: {
    readonly organizationId: string;
    readonly id: string;
    readonly actor: AuthorizationActor;
    readonly denialCode: string;
    readonly correlationId: string;
    readonly terminal: boolean;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<void>;
  list(input: {
    readonly organizationId: string;
    readonly page: number;
    readonly pageSize: number;
    readonly status?: EmergencyAccessStoredStatus;
    readonly recipientEmployeeId?: string;
    readonly risk?: EventRisk;
    readonly at: Date;
  }): Promise<EmergencyAccessPage>;
  findById(organizationId: string, id: string, at: Date, transaction?: DatabaseTransaction): Promise<EmergencyAccessGrantView | null>;
  revoke(input: {
    readonly organizationId: string;
    readonly id: string;
    readonly actorEmployeeId: string;
    readonly correlationId: string;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<{ readonly outcome: 'revoked' | 'idempotent' | 'not_found'; readonly grant: EmergencyAccessGrantView | null }>;
  revokeAllForRecipient(input: {
    readonly organizationId: string;
    readonly recipientEmployeeId: string;
    readonly actorEmployeeId: string;
    readonly correlationId: string;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<number>;
  recordMaterialUse(input: {
    readonly organizationId: string;
    readonly grantId: string;
    readonly actor: AuthorizationActor;
    readonly action: string;
    readonly resource: AuthorizationResource;
    readonly correlationId: string;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<boolean>;
}

export type EmergencyAccessRuntimeConfig = EmergencyAccessConfig;

export interface EmergencyAccessAlertHook {
  notify(input: {
    readonly category: 'requested' | 'activated' | 'denied' | 'used' | 'revoked' | 'expired';
    readonly risk: EventRisk;
    readonly outcome: 'succeeded' | 'denied';
  }): void | Promise<void>;
}

export interface EmergencyAccessMaterialUseRecorder {
  recordIfMaterial(input: {
    readonly decision: AuthorizationDecision;
    readonly actor: AuthorizationActor;
    readonly action: string;
    readonly resource: AuthorizationResource;
    readonly correlationId: string;
    readonly at: Date;
    readonly transaction: DatabaseTransaction;
  }): Promise<boolean>;
}
