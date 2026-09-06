import { Inject, Injectable } from "@nestjs/common";
import { DATABASE_CLIENT, type DatabaseClient } from "@dar-tech/database";
import type {
  AuthorizationGrant,
  AuthorizationTemporaryGrantSource,
} from "../authorization/authorization.contracts.js";
import {
  canonicalPermissionDefinition,
  permissionRecordCanBackGrant,
} from "../permissions/permission-manifest.js";

@Injectable()
export class PrismaAuthorizationTemporaryGrantSource implements AuthorizationTemporaryGrantSource {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
  ) {}

  async listGrants(
    input: Parameters<AuthorizationTemporaryGrantSource["listGrants"]>[0],
  ): Promise<readonly AuthorizationGrant[]> {
    const at = input.context.at;
    const resourceId = input.resource.id;
    const bindings = await this.client.temporaryAccessBinding.findMany({
      where: {
        organizationId: input.actor.organizationId,
        permissionKey: input.action,
        resourceType: input.resource.type,
        OR: [
          { scopeType: "ORGANIZATION", resourceId: null },
          ...(resourceId ? [{ resourceId }] : []),
        ],
        grant: {
          organizationId: input.actor.organizationId,
          recipientEmployeeId: input.actor.employeeId,
          status: "GRANTED",
          revokedAt: null,
          startsAt: { lte: at },
          expiresAt: { gt: at },
          recipientEmployee: {
            lifecycleStatus: "ACTIVE",
            userAccount: {
              authenticationEligible: true,
              disabledAt: null,
              sessions: {
                some: {
                  id: input.actor.sessionId,
                  organizationId: input.actor.organizationId,
                  employeeId: input.actor.employeeId,
                  userAccountId: input.actor.userAccountId,
                  revokedAt: null,
                  idleExpiresAt: { gt: at },
                  absoluteExpiresAt: { gt: at },
                },
              },
            },
          },
        },
        permission: { active: true, deprecatedAt: null },
      },
      include: { permission: true },
      take: 100,
    });
    return bindings.flatMap((binding) => {
      const definition = canonicalPermissionDefinition(binding.permissionKey);
      if (
        !definition ||
        binding.permissionRiskSnapshot !== definition.riskClassification ||
        !permissionRecordCanBackGrant(binding.permission, definition)
      )
        return [];
      return [
        {
          permissionKey: binding.permissionKey,
          riskClassification: binding.permissionRiskSnapshot,
          scopeType: binding.scopeType,
          scopeBindingType: binding.scopeBindingType,
          scopeBindingId: binding.scopeBindingId,
        } satisfies AuthorizationGrant,
      ];
    });
  }
}
