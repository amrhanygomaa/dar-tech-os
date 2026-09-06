import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CLIENT, type DatabaseClient } from '@dar-tech/database';
import {
  APPROVAL_POLICY_RESOLVER,
  type ApprovalPolicyResolver,
} from '../approvals/approval.contracts.js';
import { boundedApprovalPolicyInput } from '../approvals/approval-input.js';
import { validateApprovalPolicy } from '../approvals/approval-policy.js';
import type {
  AuthorizationEmergencyGrantSource,
  AuthorizationGrant,
} from '../authorization/authorization.contracts.js';
import { canonicalPermissionDefinition } from '../permissions/permission-manifest.js';
import { emergencySafeContext } from './emergency-access-input.js';

@Injectable()
export class PrismaAuthorizationEmergencyGrantSource implements AuthorizationEmergencyGrantSource {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(APPROVAL_POLICY_RESOLVER) private readonly policies: ApprovalPolicyResolver,
  ) {}

  async listGrants(
    input: Parameters<AuthorizationEmergencyGrantSource['listGrants']>[0],
  ): Promise<readonly AuthorizationGrant[]> {
    const rows = await this.client.emergencyAccessGrant.findMany({
      where: {
        organizationId: input.actor.organizationId,
        recipientEmployeeId: input.actor.employeeId,
        status: 'ACTIVE',
        requestedStartsAt: { lte: input.context.at },
        expiresAt: { gt: input.context.at },
        recipientEmployee: {
          lifecycleStatus: 'ACTIVE',
          userAccount: {
            authenticationEligible: true,
            disabledAt: null,
            id: input.actor.userAccountId,
            sessions: {
              some: {
                id: input.actor.sessionId,
                organizationId: input.actor.organizationId,
                employeeId: input.actor.employeeId,
                revokedAt: null,
                authenticatedAt: { not: null },
                idleExpiresAt: { gt: input.context.at },
                absoluteExpiresAt: { gt: input.context.at },
              },
            },
          },
        },
      },
      include: {
        bindings: { include: { permission: { select: { active: true, deprecatedAt: true } } } },
      },
      orderBy: [{ activatedAt: 'asc' }, { id: 'asc' }],
    });

    const grants: AuthorizationGrant[] = [];
    for (const row of rows) {
      const safeContext = emergencySafeContext({
        grantId: row.id,
        recipientEmployeeId: row.recipientEmployeeId,
        reason: row.safeReason,
        requestedRisk: row.requestedRisk,
        effectiveRisk: row.effectiveRisk,
        startsAt: row.requestedStartsAt,
        expiresAt: row.expiresAt,
        bindings: row.bindings.map((binding) => ({
          permissionKey: binding.permissionKey,
          riskClassification: binding.permissionRiskSnapshot,
          scopeType: binding.scopeType as Exclude<typeof binding.scopeType, 'SELF'>,
          resourceType: binding.resourceType as Parameters<typeof emergencySafeContext>[0]['bindings'][number]['resourceType'],
          resourceId: binding.resourceId,
        })),
      });
      const rawPolicy = await this.policies.resolvePolicy(
        boundedApprovalPolicyInput({
          actor: input.actor,
          action: 'admin.access.emergency',
          resource: { type: 'emergency-access-grant', organizationId: row.organizationId, id: row.id },
          risk: row.effectiveRisk,
          context: safeContext,
          at: input.context.at,
        }),
      );
      const policy = validateApprovalPolicy(rawPolicy, row.effectiveRisk);
      if (!policy || !['STEP_UP_ONLY', 'STEP_UP_AND_APPROVAL'].includes(policy.outcome) || policy.policyKey !== row.policyKey || policy.policyVersion !== row.policyVersion || policy.fingerprint !== row.policyFingerprint) continue;
      for (const binding of row.bindings) {
        if (binding.permissionKey !== input.action) continue;
        const definition = canonicalPermissionDefinition(binding.permissionKey);
        if (!definition || !binding.permission.active || binding.permission.deprecatedAt || definition.riskClassification !== binding.permissionRiskSnapshot) continue;
        grants.push({
          permissionKey: binding.permissionKey,
          riskClassification: binding.permissionRiskSnapshot,
          scopeType: binding.scopeType,
          scopeBindingType: binding.scopeBindingType,
          scopeBindingId: binding.scopeBindingId,
          sourceReference: row.id,
        });
      }
    }
    return grants;
  }
}
