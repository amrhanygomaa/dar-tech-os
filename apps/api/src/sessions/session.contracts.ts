import type { DatabaseTransaction } from '@dar-tech/database';

export const SESSION_COOKIE_NAME = 'dartech_session';
export const SESSION_REPOSITORY_PORT = Symbol('SESSION_REPOSITORY_PORT');
export const SESSION_CLOCK = Symbol('SESSION_CLOCK');
export const SESSION_CREDENTIAL_GENERATOR = Symbol('SESSION_CREDENTIAL_GENERATOR');
export const SESSION_ADMINISTRATION_AUTHORIZATION_PORT = Symbol(
  'SESSION_ADMINISTRATION_AUTHORIZATION_PORT',
);
export const SESSION_METRICS_PORT = Symbol('SESSION_METRICS_PORT');
export const SESSION_CONFIG = Symbol('SESSION_CONFIG');

export type SessionStatus =
  | 'ACTIVE'
  | 'REVOKED'
  | 'IDLE_EXPIRED'
  | 'ABSOLUTE_EXPIRED'
  | 'INACTIVE';

export interface SessionClock {
  now(): Date;
}

export interface SessionCredentialMaterial {
  readonly credential: string;
  readonly hash: string;
}

export interface SessionCredentialGenerator {
  generate(): SessionCredentialMaterial;
  hash(credential: string): string;
}

export interface SessionPrincipal {
  readonly sessionId: string;
  readonly organizationId: string;
  readonly userAccountId: string;
  readonly employeeId: string;
  readonly clientKind: 'browser';
  readonly assuranceLevel: string | null;
  readonly authenticatedAt: Date | null;
  readonly issuedAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface SessionView {
  readonly id: string;
  readonly current: boolean;
  readonly clientKind: 'browser';
  readonly assuranceLevel: string | null;
  readonly authenticatedAt: Date | null;
  readonly issuedAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly status: SessionStatus;
}

export interface SessionPage {
  readonly items: readonly (SessionView & {
    readonly employeeId: string;
    readonly userAccountId: string;
  })[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export type SessionResolution =
  | { readonly status: 'active'; readonly principal: SessionPrincipal }
  | {
      readonly status: 'invalid';
      readonly reason: 'unknown' | 'revoked' | 'idle_expired' | 'absolute_expired' | 'ineligible';
    };

export interface SessionIssueInput {
  readonly organizationId: string;
  readonly userAccountId: string;
  readonly employeeId: string;
  readonly credentialHash: string;
  readonly incomingCredentialHash?: string;
  readonly issuedAt: Date;
  readonly authenticatedAt: Date | null;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly assuranceLevel: string | null;
}

export interface SessionIssueResult {
  readonly principal: SessionPrincipal;
  readonly rotatedSessionId: string | null;
}

export interface SessionRepositoryPort {
  issue(input: SessionIssueInput): Promise<SessionIssueResult>;
  resolve(input: {
    readonly credentialHash: string;
    readonly now: Date;
    readonly idleTtlSeconds: number;
  }): Promise<SessionResolution>;
  listSelf(input: {
    readonly principal: SessionPrincipal;
    readonly now: Date;
  }): Promise<readonly SessionView[]>;
  revokeSelf(input: {
    readonly principal: SessionPrincipal;
    readonly sessionId: string;
    readonly now: Date;
  }): Promise<'revoked' | 'idempotent' | 'not_found'>;
  revokeAllSelf(input: {
    readonly principal: SessionPrincipal;
    readonly includeCurrent: boolean;
    readonly now: Date;
  }): Promise<{ readonly revokedCount: number; readonly currentRevoked: boolean }>;
  listAdministration(input: {
    readonly organizationId: string;
    readonly employeeId?: string;
    readonly page: number;
    readonly pageSize: number;
    readonly currentSessionId: string;
    readonly now: Date;
  }): Promise<SessionPage>;
  revokeAdministration(input: {
    readonly actor: SessionPrincipal;
    readonly sessionId: string;
    readonly now: Date;
  }): Promise<'revoked' | 'idempotent' | 'not_found'>;
  revokeAllForEmployee(input: {
    readonly organizationId: string;
    readonly employeeId: string;
    readonly actorEmployeeId?: string;
    readonly actorAccountId?: string;
    readonly currentSessionId?: string;
    readonly includeCurrent: boolean;
    readonly reason: 'administrative_revoke_all' | 'employee_lifecycle_revocation';
    readonly now: Date;
  }): Promise<{ readonly revokedCount: number; readonly currentRevoked: boolean } | null>;
}

export const SESSION_ADMINISTRATION_ACTIONS = {
  read: 'admin.session.read',
  revoke: 'admin.session.revoke',
} as const;
export type SessionAdministrationAction =
  (typeof SESSION_ADMINISTRATION_ACTIONS)[keyof typeof SESSION_ADMINISTRATION_ACTIONS];

export interface SessionAdministrationAuthorizationPort {
  allows(input: {
    readonly actor: SessionPrincipal;
    readonly action: SessionAdministrationAction;
    readonly resource: {
      readonly type: 'session' | 'employee-sessions';
      readonly organizationId: string;
      readonly id?: string;
    };
  }): Promise<boolean>;
}

export interface SessionMetricsPort {
  record(input: {
    readonly operation: 'issue' | 'resolve' | 'revoke' | 'revoke_all' | 'csrf';
    readonly outcome: 'succeeded' | 'denied' | 'failed';
    readonly category?: string;
  }): void;
}

export interface SessionTransactionFailureHooks {
  beforeHistory?(stage: string, transaction: DatabaseTransaction): Promise<void>;
}

export interface SessionCookieInstruction {
  readonly kind: 'set' | 'clear';
  readonly credential?: string;
  readonly absoluteExpiresAt?: Date;
  readonly issuedAt?: Date;
}
