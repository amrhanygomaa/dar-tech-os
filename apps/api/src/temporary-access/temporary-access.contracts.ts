import type { DatabaseTransaction } from "@dar-tech/database";
import type { TemporaryAccessConfig } from "@dar-tech/config";
import type {
  AuthorizationActor,
  AuthorizationGrant,
  AuthorizationResourceType,
} from "../authorization/authorization.contracts.js";
import type { EventRisk } from "../event-history/event-history.contracts.js";
import type { ScopeType } from "../permissions/permission.contracts.js";

export const TEMPORARY_ACCESS_CONFIG = Symbol("TEMPORARY_ACCESS_CONFIG");
export const TEMPORARY_ACCESS_REPOSITORY = Symbol(
  "TEMPORARY_ACCESS_REPOSITORY",
);

export type TemporaryAccessStoredStatus =
  "PENDING_APPROVAL" | "GRANTED" | "REVOKED" | "EXPIRED";
export type TemporaryAccessEffectiveStatus =
  "PENDING_APPROVAL" | "SCHEDULED" | "ACTIVE" | "REVOKED" | "EXPIRED";

export interface TemporaryAccessBindingInput {
  readonly permissionKey: string;
  readonly scopeType: Exclude<ScopeType, "SELF">;
  readonly resourceType: AuthorizationResourceType;
  readonly resourceId: string | null;
}

export interface TemporaryAccessBindingView extends TemporaryAccessBindingInput {
  readonly id: string;
  readonly riskClassification: EventRisk;
}

export interface TemporaryAccessGrantView {
  readonly id: string;
  readonly organizationId: string;
  readonly issuerEmployeeId: string;
  readonly recipientEmployeeId: string;
  readonly issuerSnapshot: Readonly<Record<string, string>>;
  readonly recipientSnapshot: Readonly<Record<string, string>>;
  readonly reason: string;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly storedStatus: TemporaryAccessStoredStatus;
  readonly status: TemporaryAccessEffectiveStatus;
  readonly approvalReference: string | null;
  readonly requestedAt: Date;
  readonly grantedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokedByEmployeeId: string | null;
  readonly bindings: readonly TemporaryAccessBindingView[];
  readonly canRevoke: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface TemporaryAccessPage {
  readonly items: readonly TemporaryAccessGrantView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface TemporaryAccessRecipient {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly displayName: string;
  readonly employeeCode: string;
  readonly active: boolean;
}

export interface TemporaryAccessCreateData {
  readonly actor: AuthorizationActor;
  readonly recipient: TemporaryAccessRecipient;
  readonly reason: string;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly bindings: readonly (TemporaryAccessBindingInput & {
    readonly riskClassification: EventRisk;
  })[];
  readonly idempotencyDigest: string;
  readonly requestFingerprint: string;
  readonly contextFingerprint: string;
  readonly approvalReference: string | null;
  readonly granted: boolean;
  readonly correlationId: string;
  readonly at: Date;
}

export interface TemporaryAccessRepositoryPort {
  transaction<T>(
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T>;
  lockIdempotency(
    transaction: DatabaseTransaction,
    digest: string,
  ): Promise<void>;
  findRecipient(
    organizationId: string,
    employeeId: string,
    transaction?: DatabaseTransaction,
  ): Promise<TemporaryAccessRecipient | null>;
  findByIdempotency(
    organizationId: string,
    digest: string,
    at: Date,
    transaction?: DatabaseTransaction,
  ): Promise<TemporaryAccessGrantView | null>;
  create(
    input: TemporaryAccessCreateData,
    transaction: DatabaseTransaction,
  ): Promise<TemporaryAccessGrantView>;
  activate(
    input: {
      readonly organizationId: string;
      readonly grantId: string;
      readonly actorEmployeeId: string;
      readonly approvalReference: string;
      readonly correlationId: string;
      readonly at: Date;
    },
    transaction: DatabaseTransaction,
  ): Promise<TemporaryAccessGrantView>;
  list(input: {
    readonly organizationId: string;
    readonly page: number;
    readonly pageSize: number;
    readonly status?: TemporaryAccessEffectiveStatus;
    readonly recipientEmployeeId?: string;
    readonly at: Date;
  }): Promise<TemporaryAccessPage>;
  findById(
    organizationId: string,
    id: string,
    at: Date,
    transaction?: DatabaseTransaction,
  ): Promise<TemporaryAccessGrantView | null>;
  revoke(
    input: {
      readonly organizationId: string;
      readonly id: string;
      readonly actorEmployeeId: string;
      readonly correlationId: string;
      readonly at: Date;
    },
    transaction: DatabaseTransaction,
  ): Promise<{
    readonly outcome: "revoked" | "idempotent" | "not_found";
    readonly grant: TemporaryAccessGrantView | null;
  }>;
  revokeAllForRecipient(
    input: {
      readonly organizationId: string;
      readonly recipientEmployeeId: string;
      readonly actorEmployeeId: string;
      readonly correlationId: string;
      readonly at: Date;
    },
    transaction: DatabaseTransaction,
  ): Promise<number>;
}

export type TemporaryAccessRuntimeConfig = TemporaryAccessConfig;

export interface TemporaryAccessProjection {
  readonly grant: AuthorizationGrant;
}
