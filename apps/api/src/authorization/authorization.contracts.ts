import type { EventRisk } from '../event-history/event-history.contracts.js';
import type { ScopeType } from '../permissions/permission.contracts.js';
import type { SessionPrincipal } from '../sessions/session.contracts.js';

export const AUTHORIZATION_CLOCK = Symbol('AUTHORIZATION_CLOCK');
export const AUTHORIZATION_GRANT_REPOSITORY = Symbol('AUTHORIZATION_GRANT_REPOSITORY');
export const AUTHORIZATION_METRICS_PORT = Symbol('AUTHORIZATION_METRICS_PORT');
export const AUTHORIZATION_RESOLVER_METRICS_PORT = Symbol('AUTHORIZATION_RESOLVER_METRICS_PORT');
export const AUTHORIZATION_SCOPE_RESOLVERS = Symbol('AUTHORIZATION_SCOPE_RESOLVERS');
export const AUTHORIZATION_SCOPE_RESOLVER_REGISTRY = Symbol(
  'AUTHORIZATION_SCOPE_RESOLVER_REGISTRY',
);
export const AUTHORIZATION_TEMPORARY_GRANT_SOURCE = Symbol('AUTHORIZATION_TEMPORARY_GRANT_SOURCE');
export const AUTHORIZATION_EMERGENCY_GRANT_SOURCE = Symbol('AUTHORIZATION_EMERGENCY_GRANT_SOURCE');
export const AUTHORIZATION_POLICY_EVALUATOR = Symbol('AUTHORIZATION_POLICY_EVALUATOR');

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

export interface AuthorizationScopeResolverCapability {
  readonly scopeType: ExtensionScopeType;
  readonly resourceType: AuthorizationResourceType;
}

export interface AuthorizationScopeResolverInput {
  readonly actor: AuthorizationActor;
  readonly organizationId: string;
  readonly grant: AuthorizationGrant & { readonly scopeType: ExtensionScopeType };
  readonly resource: AuthorizationResource;
  readonly context: AuthorizationContext;
}

export interface AuthorizationScopeResolver {
  /**
   * Compatibility seam for T07 test adapters. Production resolver ownership is
   * declared with `AuthorizationScopeResolverFor` and never selected by order.
   */
  canResolve(scopeType: ExtensionScopeType, resourceType: AuthorizationResourceType): boolean;
  resolve(input: AuthorizationScopeResolverInput): Promise<ScopeResolution>;
}

export type AuthorizationScopeRegistryOutcome =
  | 'MATCH'
  | 'NO_MATCH'
  | 'UNAVAILABLE'
  | 'ERROR';

export interface AuthorizationScopeResolverRegistryPort {
  resolve(input: AuthorizationScopeResolverInput): Promise<AuthorizationScopeRegistryOutcome>;
}

export interface AuthorizationMetricsPort {
  record(input: {
    readonly outcome: 'allowed' | 'denied';
    readonly reasonCode: AuthorizationReasonCode;
    readonly actionFamily: string;
    readonly scopeType?: ScopeType;
  }): void;
}

export type AuthorizationResolverLatencyBucket =
  | 'LT_5_MS'
  | 'LT_25_MS'
  | 'LT_100_MS'
  | 'LT_500_MS'
  | 'GTE_500_MS';

export interface AuthorizationResolverMetricsPort {
  recordResolver(input: {
    readonly scopeType: ExtensionScopeType;
    readonly resourceType: AuthorizationResourceType;
    readonly outcome: 'MATCH' | 'NO_MATCH' | 'UNAVAILABLE' | 'ERROR';
    readonly latencyBucket: AuthorizationResolverLatencyBucket;
  }): void;
}

export interface AuthorizationAlternateGrantSourceInput {
  readonly actor: AuthorizationActor;
  readonly action: string;
  readonly resource: AuthorizationResource;
  readonly context: AuthorizationContext;
}

/**
 * Deferred T10/T11 boundary. A source can contribute descriptors only; the
 * central engine remains the sole evaluator that can produce an allow.
 */
export interface AuthorizationAlternateGrantSource {
  listGrants(input: AuthorizationAlternateGrantSourceInput): Promise<readonly AuthorizationGrant[]>;
}

export type AuthorizationTemporaryGrantSource = AuthorizationAlternateGrantSource;
export type AuthorizationEmergencyGrantSource = AuthorizationAlternateGrantSource;

export interface AuthorizationPolicyInput {
  readonly actor: AuthorizationActor;
  readonly action: string;
  readonly resource: AuthorizationResource;
  readonly context: AuthorizationContext;
  readonly grant: AuthorizationGrant;
}

export interface AuthorizationPolicyResult {
  readonly allowed: boolean;
  readonly reasonCode?: AuthorizationReasonCode;
}

/** Deferred T09 seam. The T07 default permits a descriptor already validated centrally. */
export interface AuthorizationPolicyEvaluator {
  evaluatePolicy(input: AuthorizationPolicyInput): Promise<AuthorizationPolicyResult>;
}
