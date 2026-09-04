import { Inject, Injectable, Optional } from '@nestjs/common';
import { canonicalPermissionDefinition } from '../permissions/permission-manifest.js';
import { SCOPE_TYPES, type ScopeType } from '../permissions/permission.contracts.js';
import {
  AUTHORIZATION_EMERGENCY_GRANT_SOURCE,
  AUTHORIZATION_GRANT_REPOSITORY,
  AUTHORIZATION_METRICS_PORT,
  AUTHORIZATION_POLICY_EVALUATOR,
  AUTHORIZATION_RESOURCE_TYPES,
  AUTHORIZATION_SCOPE_RESOLVERS,
  AUTHORIZATION_TEMPORARY_GRANT_SOURCE,
  EXTENSION_SCOPE_TYPES,
  type AuthorizationActor,
  type AuthorizationContext,
  type AuthorizationDecision,
  type AuthorizationEmergencyGrantSource,
  type AuthorizationGrant,
  type AuthorizationGrantRepository,
  type AuthorizationMetricsPort,
  type AuthorizationPolicyEvaluator,
  type AuthorizationPolicyResult,
  type AuthorizationReasonCode,
  type AuthorizationResource,
  type AuthorizationScopeResolver,
  type AuthorizationTemporaryGrantSource,
  type ExtensionScopeType,
} from './authorization.contracts.js';
import {
  DefaultAuthorizationEmergencyGrantSource,
  DefaultAuthorizationPolicyEvaluator,
  DefaultAuthorizationTemporaryGrantSource,
} from './authorization-extensions.js';

type ScopeEvaluation = 'MATCH' | 'NO_MATCH' | 'RESOLVER_UNAVAILABLE';
type GrantEvaluation =
  | { readonly allowedGrant: AuthorizationGrant }
  | { readonly reasonCode: AuthorizationReasonCode }
  | undefined;
const POLICY_DENIAL_REASON_CODES: ReadonlySet<AuthorizationReasonCode> = new Set([
  'AUTHENTICATION_REQUIRED',
  'ORGANIZATION_MISMATCH',
  'PERMISSION_INVALID',
  'PERMISSION_NOT_GRANTED',
  'RESOURCE_INVALID',
  'SCOPE_NOT_SATISFIED',
  'SCOPE_RESOLVER_UNAVAILABLE',
  'AUTHORIZATION_DEPENDENCY_FAILED',
]);
const SCOPE_BINDING_TYPE_PATTERN = /^[a-z][a-z0-9._-]*$/u;
const SCOPE_BINDING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(AUTHORIZATION_GRANT_REPOSITORY)
    private readonly grants: AuthorizationGrantRepository,
    @Inject(AUTHORIZATION_SCOPE_RESOLVERS)
    private readonly resolvers: readonly AuthorizationScopeResolver[],
    @Inject(AUTHORIZATION_METRICS_PORT)
    private readonly metrics: AuthorizationMetricsPort,
    @Optional()
    @Inject(AUTHORIZATION_TEMPORARY_GRANT_SOURCE)
    private readonly temporaryGrants: AuthorizationTemporaryGrantSource = new DefaultAuthorizationTemporaryGrantSource(),
    @Optional()
    @Inject(AUTHORIZATION_EMERGENCY_GRANT_SOURCE)
    private readonly emergencyGrants: AuthorizationEmergencyGrantSource = new DefaultAuthorizationEmergencyGrantSource(),
    @Optional()
    @Inject(AUTHORIZATION_POLICY_EVALUATOR)
    private readonly policyEvaluator: AuthorizationPolicyEvaluator = new DefaultAuthorizationPolicyEvaluator(),
  ) {}

  async authorize(
    actor: AuthorizationActor | null,
    action: string,
    resource: AuthorizationResource,
    context: AuthorizationContext,
  ): Promise<AuthorizationDecision> {
    if (!actor || !this.validActor(actor)) {
      return this.decision(false, 'AUTHENTICATION_REQUIRED', action);
    }
    if (!this.validResource(resource) || !this.validContext(context)) {
      return this.decision(false, 'RESOURCE_INVALID', action);
    }
    if (resource.organizationId !== actor.organizationId) {
      return this.decision(false, 'ORGANIZATION_MISMATCH', action);
    }
    if (!canonicalPermissionDefinition(action)) {
      return this.decision(false, 'PERMISSION_INVALID', action);
    }

    let currentGrants: readonly AuthorizationGrant[];
    try {
      currentGrants = await this.grants.listEffectivePermissionGrantsForEmployee(
        actor.organizationId,
        actor.employeeId,
        context.at,
      );
    } catch {
      return this.decision(false, 'AUTHORIZATION_DEPENDENCY_FAILED', action);
    }

    const normal = await this.evaluateGrants(
      actor,
      action,
      resource,
      context,
      currentGrants.filter((grant) => grant.permissionKey === action),
    );
    if (normal && 'allowedGrant' in normal) {
      return this.decision(true, 'AUTHORIZED', action, normal.allowedGrant);
    }
    if (normal?.reasonCode === 'AUTHORIZATION_DEPENDENCY_FAILED') {
      return this.decision(false, normal.reasonCode, action);
    }

    let alternateGrants: readonly AuthorizationGrant[];
    try {
      const input = { actor, action, resource, context };
      const [temporary, emergency] = await Promise.all([
        this.temporaryGrants.listGrants(input),
        this.emergencyGrants.listGrants(input),
      ]);
      alternateGrants = [...temporary, ...emergency].filter((grant) =>
        this.validAlternateGrant(grant, action),
      );
    } catch {
      return this.decision(false, 'AUTHORIZATION_DEPENDENCY_FAILED', action);
    }

    const alternate = await this.evaluateGrants(actor, action, resource, context, alternateGrants);
    if (alternate && 'allowedGrant' in alternate) {
      return this.decision(true, 'AUTHORIZED', action, alternate.allowedGrant);
    }
    if (alternate?.reasonCode === 'AUTHORIZATION_DEPENDENCY_FAILED') {
      return this.decision(false, alternate.reasonCode, action);
    }
    return this.decision(
      false,
      alternate?.reasonCode ?? normal?.reasonCode ?? 'PERMISSION_NOT_GRANTED',
      action,
    );
  }

  private async evaluateGrants(
    actor: AuthorizationActor,
    action: string,
    resource: AuthorizationResource,
    context: AuthorizationContext,
    grants: readonly AuthorizationGrant[],
  ): Promise<GrantEvaluation> {
    if (grants.length === 0) return undefined;
    let reasonCode: AuthorizationReasonCode = 'SCOPE_NOT_SATISFIED';
    for (const grant of grants) {
      const scope = await this.evaluateScope(actor, grant, resource, context);
      if (scope !== 'MATCH') {
        if (scope === 'RESOLVER_UNAVAILABLE') reasonCode = 'SCOPE_RESOLVER_UNAVAILABLE';
        continue;
      }
      try {
        const policyResult: AuthorizationPolicyResult = await this.policyEvaluator.evaluatePolicy({
          actor,
          action,
          resource,
          context,
          grant,
        });
        if (!policyResult || typeof policyResult !== 'object') {
          return { reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED' };
        }
        if (policyResult.allowed === true) return { allowedGrant: grant };
        if (policyResult.allowed !== false) {
          return { reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED' };
        }
        if (
          policyResult.reasonCode !== undefined &&
          !POLICY_DENIAL_REASON_CODES.has(policyResult.reasonCode)
        ) {
          return { reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED' };
        }
        reasonCode = policyResult.reasonCode ?? 'SCOPE_NOT_SATISFIED';
      } catch {
        return { reasonCode: 'AUTHORIZATION_DEPENDENCY_FAILED' };
      }
    }
    return { reasonCode };
  }

  private async evaluateScope(
    actor: AuthorizationActor,
    grant: AuthorizationGrant,
    resource: AuthorizationResource,
    context: AuthorizationContext,
  ): Promise<ScopeEvaluation> {
    if (grant.scopeType === 'ORGANIZATION') return 'MATCH';
    if (grant.scopeType === 'SELF') return this.matchesSelf(actor, resource) ? 'MATCH' : 'NO_MATCH';
    if (grant.scopeType === 'EXPLICIT') {
      return resource.id &&
        grant.scopeBindingType === resource.type &&
        grant.scopeBindingId === resource.id
        ? 'MATCH'
        : 'NO_MATCH';
    }
    if (!this.isExtensionScope(grant.scopeType)) return 'NO_MATCH';

    let resolver: AuthorizationScopeResolver | undefined;
    try {
      resolver = this.resolvers.find((candidate) =>
        candidate.canResolve(grant.scopeType as ExtensionScopeType, resource.type),
      );
    } catch {
      return 'RESOLVER_UNAVAILABLE';
    }
    if (!resolver) return 'RESOLVER_UNAVAILABLE';
    try {
      return (await resolver.resolve({
        actor,
        grant: { ...grant, scopeType: grant.scopeType as ExtensionScopeType },
        resource,
        context,
      })) === 'MATCH'
        ? 'MATCH'
        : 'NO_MATCH';
    } catch {
      return 'RESOLVER_UNAVAILABLE';
    }
  }

  private matchesSelf(actor: AuthorizationActor, resource: AuthorizationResource): boolean {
    if (!['user-account', 'session', 'employee-sessions'].includes(resource.type)) return false;
    if (resource.ownerEmployeeId !== actor.employeeId) return false;
    if (resource.ownerUserAccountId !== actor.userAccountId) return false;
    if (resource.type === 'user-account' && resource.id !== actor.userAccountId) return false;
    return true;
  }

  private validActor(actor: AuthorizationActor): boolean {
    return (
      actor.actorType === 'employee' &&
      [actor.sessionId, actor.organizationId, actor.userAccountId, actor.employeeId].every(
        (value) => typeof value === 'string' && value.length > 0,
      )
    );
  }

  private validResource(resource: AuthorizationResource): boolean {
    return (
      AUTHORIZATION_RESOURCE_TYPES.includes(resource.type) &&
      typeof resource.organizationId === 'string' &&
      resource.organizationId.length > 0 &&
      (resource.id === undefined || (resource.id.length > 0 && resource.id.length <= 160))
    );
  }

  private validAlternateGrant(grant: AuthorizationGrant, action: string): boolean {
    const definition = canonicalPermissionDefinition(action);
    if (
      !definition ||
      !grant ||
      grant.permissionKey !== action ||
      grant.riskClassification !== definition.riskClassification ||
      !SCOPE_TYPES.includes(grant.scopeType)
    ) {
      return false;
    }
    const hasType =
      typeof grant.scopeBindingType === 'string' &&
      grant.scopeBindingType.length <= 80 &&
      SCOPE_BINDING_TYPE_PATTERN.test(grant.scopeBindingType);
    const hasId =
      typeof grant.scopeBindingId === 'string' &&
      grant.scopeBindingId.length <= 128 &&
      SCOPE_BINDING_ID_PATTERN.test(grant.scopeBindingId);
    if (hasType !== hasId) return false;
    if (grant.scopeType === 'EXPLICIT') {
      return (
        hasType &&
        hasId &&
        AUTHORIZATION_RESOURCE_TYPES.includes(grant.scopeBindingType as AuthorizationResource['type'])
      );
    }
    if (grant.scopeType === 'SELF' || grant.scopeType === 'ORGANIZATION') {
      return grant.scopeBindingType === null && grant.scopeBindingId === null;
    }
    return (grant.scopeBindingType === null && grant.scopeBindingId === null) || (hasType && hasId);
  }

  private validContext(context: AuthorizationContext): boolean {
    return (
      context.at instanceof Date &&
      Number.isFinite(context.at.getTime()) &&
      ['http', 'application', 'test'].includes(context.source)
    );
  }

  private isExtensionScope(scope: ScopeType): boolean {
    return EXTENSION_SCOPE_TYPES.includes(scope as ExtensionScopeType);
  }

  private decision(
    allowed: boolean,
    reasonCode: AuthorizationReasonCode,
    permissionKey: string,
    grant?: AuthorizationGrant,
  ): AuthorizationDecision {
    try {
      this.metrics.record({
        outcome: allowed ? 'allowed' : 'denied',
        reasonCode,
        actionFamily: this.actionFamily(permissionKey),
        ...(grant ? { scopeType: grant.scopeType } : {}),
      });
    } catch {
      // Observability is bounded and best-effort; it never changes a decision.
    }
    return {
      allowed,
      reasonCode,
      permissionKey,
      ...(grant
        ? {
            matchedGrant: {
              scopeType: grant.scopeType,
              riskClassification: grant.riskClassification,
            },
          }
        : {}),
    };
  }

  private actionFamily(permissionKey: string): string {
    const def = canonicalPermissionDefinition(permissionKey);
    if (!def) return 'invalid';
    const parts = def.key.split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : 'invalid';
  }
}
