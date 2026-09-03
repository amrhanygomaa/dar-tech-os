import type { EventRisk } from '../event-history/event-history.contracts.js';
import type { ScopeType } from '../permissions/permission.contracts.js';
import type { SessionPrincipal } from '../sessions/session.contracts.js';

export const AUTHORIZATION_CLOCK = Symbol('AUTHORIZATION_CLOCK');
export const AUTHORIZATION_GRANT_REPOSITORY = Symbol('AUTHORIZATION_GRANT_REPOSITORY');
export const AUTHORIZATION_METRICS_PORT = Symbol('AUTHORIZATION_METRICS_PORT');
export const AUTHORIZATION_SCOPE_RESOLVERS = Symbol('AUTHORIZATION_SCOPE_RESOLVERS');

export const AUTHORIZATION_RESOURCE_TYPES = [
  'employee',
  'user-account',
  'invitation',
  'role',
  'employee-role',
  'permission-registry',
  'role-permissions',
  'session',
  'employee-sessions',
  'audit-event',
  'security-event',
] as const;

export type AuthorizationResourceType = (typeof AUTHORIZATION_RESOURCE_TYPES)[number];

export interface AuthorizationActor extends SessionPrincipal {
  readonly actorType: 'employee';
}

export interface AuthorizationResource {
  readonly type: AuthorizationResourceType;
  readonly organizationId: string;
  readonly id?: string;
  readonly ownerEmployeeId?: string;
  readonly ownerUserAccountId?: string;
}

export interface AuthorizationContext {
  readonly at: Date;
  readonly source: 'http' | 'application' | 'test';
}

export type AuthorizationReasonCode =
  | 'AUTHORIZED'
  | 'AUTHENTICATION_REQUIRED'
  | 'ORGANIZATION_MISMATCH'
  | 'PERMISSION_INVALID'
  | 'PERMISSION_NOT_GRANTED'
  | 'RESOURCE_INVALID'
  | 'SCOPE_NOT_SATISFIED'
  | 'SCOPE_RESOLVER_UNAVAILABLE'
  | 'AUTHORIZATION_DEPENDENCY_FAILED';

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reasonCode: AuthorizationReasonCode;
  readonly permissionKey: string;
  readonly matchedGrant?: {
    readonly scopeType: ScopeType;
    readonly riskClassification: EventRisk;
  };
}

export interface AuthorizationClock {
  now(): Date;
}

export interface AuthorizationGrant {
  readonly permissionKey: string;
  readonly riskClassification: EventRisk;
  readonly scopeType: ScopeType;
  readonly scopeBindingType: string | null;
  readonly scopeBindingId: string | null;
}

export interface AuthorizationGrantRepository {
  listEffectivePermissionGrantsForEmployee(
    organizationId: string,
    employeeId: string,
    at: Date,
  ): Promise<readonly AuthorizationGrant[]>;
}

export const EXTENSION_SCOPE_TYPES = [
  'ASSIGNED',
  'TEAM',
  'DEPARTMENT',
  'PROJECT',
  'CUSTOMER',
] as const;

export type ExtensionScopeType = (typeof EXTENSION_SCOPE_TYPES)[number];
export type ScopeResolution = 'MATCH' | 'NO_MATCH';

export interface AuthorizationScopeResolver {
  canResolve(scopeType: ExtensionScopeType, resourceType: AuthorizationResourceType): boolean;
  resolve(input: {
    readonly actor: AuthorizationActor;
    readonly grant: AuthorizationGrant & { readonly scopeType: ExtensionScopeType };
    readonly resource: AuthorizationResource;
    readonly context: AuthorizationContext;
  }): Promise<ScopeResolution>;
}

export interface AuthorizationMetricsPort {
  record(input: {
    readonly outcome: 'allowed' | 'denied';
    readonly reasonCode: AuthorizationReasonCode;
    readonly actionFamily: string;
    readonly scopeType?: ScopeType;
  }): void;
}
