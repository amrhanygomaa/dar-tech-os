import { Inject, Injectable } from '@nestjs/common';
import { canonicalPermissionDefinition } from '../permissions/permission-manifest.js';
import type { ScopeType } from '../permissions/permission.contracts.js';
import {
  AUTHORIZATION_GRANT_REPOSITORY,
  AUTHORIZATION_METRICS_PORT,
  AUTHORIZATION_RESOURCE_TYPES,
  AUTHORIZATION_SCOPE_RESOLVERS,
  EXTENSION_SCOPE_TYPES,
  type AuthorizationActor,
  type AuthorizationContext,
  type AuthorizationDecision,
  type AuthorizationGrant,
  type AuthorizationGrantRepository,
  type AuthorizationMetricsPort,
  type AuthorizationReasonCode,
  type AuthorizationResource,
  type AuthorizationScopeResolver,
  type ExtensionScopeType,
} from './authorization.contracts.js';

type ScopeEvaluation = 'MATCH' | 'NO_MATCH' | 'RESOLVER_UNAVAILABLE';

@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(AUTHORIZATION_GRANT_REPOSITORY)
    private readonly grants: AuthorizationGrantRepository,
    @Inject(AUTHORIZATION_SCOPE_RESOLVERS)
    private readonly resolvers: readonly AuthorizationScopeResolver[],
    @Inject(AUTHORIZATION_METRICS_PORT)
    private readonly metrics: AuthorizationMetricsPort,
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

    const matching = currentGrants.filter((grant) => grant.permissionKey === action);
    if (matching.length === 0) {
      return this.decision(false, 'PERMISSION_NOT_GRANTED', action);
    }

    let missingResolver = false;
    for (const grant of matching) {
      const scope = await this.evaluateScope(actor, grant, resource, context);
      if (scope === 'MATCH') {
        return this.decision(true, 'AUTHORIZED', action, grant);
      }
      missingResolver ||= scope === 'RESOLVER_UNAVAILABLE';
    }
    return this.decision(
      false,
      missingResolver ? 'SCOPE_RESOLVER_UNAVAILABLE' : 'SCOPE_NOT_SATISFIED',
      action,
    );
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
    const parts = permissionKey.split('.');
    return parts.length === 3 ? `${parts[0]}.${parts[1]}` : 'invalid';
  }
}
