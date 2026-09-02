import type { DatabaseTransaction } from '@dar-tech/database';

export const EVENT_RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type EventRisk = (typeof EVENT_RISKS)[number];

export const AUDIT_ACTION_KEYS = {
  updateSelf: 'identity.account.update_self',
  updateEmployee: 'admin.employee.update',
  invitationIssued: 'admin.employee.invite',
  invitationRevoked: 'admin.invitation.revoke',
  invitationAccepted: 'identity.invitation.accept',
  onboardingCompleted: 'identity.onboarding.complete',
  invitationExpired: 'system.invitation.expire',
  invitationSuperseded: 'admin.invitation.supersede',
  invitationReissued: 'admin.invitation.resend',
  roleCreated: 'admin.role.create',
  roleUpdated: 'admin.role.update',
  roleArchived: 'admin.role.archive',
  employeeRoleAssigned: 'admin.role.assign',
  employeeRoleRemoved: 'admin.role.assign',
} as const;
export type AuditActionKey = (typeof AUDIT_ACTION_KEYS)[keyof typeof AUDIT_ACTION_KEYS];

export const SECURITY_EVENT_TYPES = {
  authenticationSucceeded: 'AuthenticationSucceeded.v1',
  authenticationFailed: 'AuthenticationFailed.v1',
  invitationIssued: 'InvitationIssued.v1',
  invitationRevoked: 'InvitationRevoked.v1',
  invitationAccepted: 'InvitationAccepted.v1',
  invitationExpired: 'InvitationExpired.v1',
  onboardingCompleted: 'OnboardingCompleted.v1',
  invitationAcceptanceFailed: 'InvitationAcceptanceFailed.v1',
  invitationSuperseded: 'InvitationSuperseded.v1',
  invitationReissued: 'InvitationReissued.v1',
} as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[keyof typeof SECURITY_EVENT_TYPES];

export const EVENT_HISTORY_READ_ACTIONS = {
  audit: 'audit.event.read',
  security: 'security.event.read',
} as const;
export type EventHistoryReadAction = (typeof EVENT_HISTORY_READ_ACTIONS)[keyof typeof EVENT_HISTORY_READ_ACTIONS];

export interface HistoricalActorSnapshot {
  readonly type: 'employee' | 'system' | 'unresolved';
  readonly displayName?: string;
  readonly employeeCode?: string;
}

export interface HistoricalTargetSnapshot {
  readonly displayName?: string;
  readonly employeeCode?: string;
}

export interface SafeAuditDelta {
  readonly changedFields: readonly string[];
}

export type SafeSecurityContext = Readonly<Record<string, string | number | boolean | null>>;

export interface AuditEventAppendInput {
  readonly organizationId: string;
  readonly actionKey: AuditActionKey;
  readonly actorEmployeeId?: string;
  readonly actorSnapshot: HistoricalActorSnapshot;
  readonly targetType: string;
  readonly targetId: string;
  readonly targetSnapshot?: HistoricalTargetSnapshot;
  readonly requestId?: string;
  readonly correlationId: string;
  readonly sessionReference?: string;
  readonly safeReason?: string;
  readonly changeDelta?: SafeAuditDelta;
  readonly approvalReference?: string;
  readonly occurredAt?: Date;
  readonly eventVersion?: number;
  readonly integrityVersion?: number;
}

export interface SecurityEventAppendInput {
  readonly organizationId?: string;
  readonly eventType: SecurityEventType;
  readonly category: string;
  readonly risk: EventRisk;
  readonly outcome: string;
  readonly actorEmployeeId?: string;
  readonly actorAccountId?: string;
  readonly providerKey?: string;
  readonly sessionReference?: string;
  readonly actorSnapshot?: HistoricalActorSnapshot;
  readonly safeContext?: SafeSecurityContext;
  readonly requestId?: string;
  readonly correlationId: string;
  readonly networkContext?: Readonly<{
    countryCode?: string;
    ipPrefix?: string;
  }>;
  readonly deviceContext?: Readonly<{
    deviceClass?: string;
    userAgentFamily?: string;
  }>;
  readonly occurredAt?: Date;
  readonly eventVersion?: number;
}

export interface AuditEventView extends Omit<
  AuditEventAppendInput,
  | 'actorEmployeeId'
  | 'requestId'
  | 'sessionReference'
  | 'safeReason'
  | 'approvalReference'
  | 'occurredAt'
  | 'eventVersion'
  | 'integrityVersion'
> {
  readonly id: string;
  readonly actorEmployeeId: string | null;
  readonly targetSnapshot?: HistoricalTargetSnapshot;
  readonly requestId: string | null;
  readonly sessionReference: string | null;
  readonly safeReason: string | null;
  readonly changeDelta?: SafeAuditDelta;
  readonly approvalReference: string | null;
  readonly occurredAt: Date;
  readonly createdAt: Date;
  readonly eventVersion: number;
  readonly integrityVersion: number;
}

export interface SecurityEventView extends Omit<
  SecurityEventAppendInput,
  | 'organizationId'
  | 'actorEmployeeId'
  | 'actorAccountId'
  | 'providerKey'
  | 'sessionReference'
  | 'requestId'
  | 'occurredAt'
  | 'eventVersion'
> {
  readonly id: string;
  readonly organizationId: string | null;
  readonly actorEmployeeId: string | null;
  readonly actorAccountId: string | null;
  readonly providerKey: string | null;
  readonly sessionReference: string | null;
  readonly requestId: string | null;
  readonly occurredAt: Date;
  readonly createdAt: Date;
  readonly eventVersion: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface OccurredRangeFilter {
  readonly occurredFrom?: Date;
  readonly occurredTo?: Date;
}

export interface AuditEventFilters extends OccurredRangeFilter {
  readonly actionKey?: string;
  readonly targetType?: string;
}

export interface SecurityEventFilters extends OccurredRangeFilter {
  readonly eventType?: string;
  readonly category?: string;
  readonly outcome?: string;
  readonly risk?: EventRisk;
}

export interface AuditEventAppendPort {
  append(input: AuditEventAppendInput, transaction?: DatabaseTransaction): Promise<AuditEventView>;
}

export interface SecurityEventAppendPort {
  append(input: SecurityEventAppendInput, transaction?: DatabaseTransaction): Promise<SecurityEventView>;
}

export interface AuditEventReadRepositoryPort {
  list(
    organizationId: string,
    filters: AuditEventFilters,
    page: number,
    pageSize: number,
  ): Promise<Page<AuditEventView>>;
  findById(organizationId: string, id: string): Promise<AuditEventView | null>;
}

export interface SecurityEventReadRepositoryPort {
  list(
    organizationId: string,
    filters: SecurityEventFilters,
    page: number,
    pageSize: number,
  ): Promise<Page<SecurityEventView>>;
  findById(organizationId: string, id: string): Promise<SecurityEventView | null>;
}

export interface EventHistoryActor {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
}

export interface EventHistoryActorPort {
  currentActor(): Promise<EventHistoryActor | null>;
}

export interface EventHistoryAuthorizationPort {
  authorize(request: {
    readonly actor: EventHistoryActor;
    readonly action: EventHistoryReadAction;
    readonly resource: {
      readonly type: 'audit-event' | 'security-event';
      readonly organizationId: string;
      readonly id?: string;
    };
  }): Promise<boolean>;
}

export interface EventHistoryMetricsPort {
  recordWrite(kind: 'audit' | 'security', outcome: 'succeeded' | 'failed'): void;
  recordVolume(input: {
    readonly kind: 'audit' | 'security';
    readonly category: string;
    readonly outcome: string;
    readonly risk?: EventRisk;
  }): void;
}

export const AUDIT_EVENT_APPEND_PORT = Symbol('AUDIT_EVENT_APPEND_PORT');
export const AUDIT_EVENT_READ_REPOSITORY_PORT = Symbol('AUDIT_EVENT_READ_REPOSITORY_PORT');
export const SECURITY_EVENT_APPEND_PORT = Symbol('SECURITY_EVENT_APPEND_PORT');
export const SECURITY_EVENT_READ_REPOSITORY_PORT = Symbol('SECURITY_EVENT_READ_REPOSITORY_PORT');
export const EVENT_HISTORY_ACTOR_PORT = Symbol('EVENT_HISTORY_ACTOR_PORT');
export const EVENT_HISTORY_AUTHORIZATION_PORT = Symbol('EVENT_HISTORY_AUTHORIZATION_PORT');
export const EVENT_HISTORY_METRICS_PORT = Symbol('EVENT_HISTORY_METRICS_PORT');
