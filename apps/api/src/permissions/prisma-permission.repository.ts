import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  DATABASE_CLIENT,
  Prisma,
  runInTransaction,
  type DatabaseClient,
  type DatabaseTransaction,
} from "@dar-tech/database";
import {
  REQUEST_CONTEXT_STORE,
  type RequestContextStore,
} from "@dar-tech/observability";
import { persistOutboxEvent } from "@dar-tech/outbox";
import {
  AUDIT_ACTION_KEYS,
  AUDIT_EVENT_APPEND_PORT,
  SECURITY_EVENT_APPEND_PORT,
  SECURITY_EVENT_TYPES,
  type AuditEventAppendPort,
  type HistoricalActorSnapshot,
  type SecurityEventAppendPort,
} from "../event-history/event-history.contracts.js";
import type {
  EffectivePermissionGrant,
  PermissionPage,
  PermissionRepositoryPort,
  PermissionView,
  RolePermissionPage,
  RolePermissionView,
  ScopeType,
} from "./permission.contracts.js";
import { PERMISSION_EVENT_CONTRACTS } from "./permission.events.js";
import { PermissionRegistryDriftError } from "./permission.errors.js";
import {
  PERMISSION_REGISTRY,
  canonicalPermissionDefinition,
  permissionRecordCanBackGrant,
  type PermissionDefinition,
  type PermissionDefinitionRecord,
} from "./permission-manifest.js";
import { validatePermissionRegistryRecords } from "./permission-registry-validation.js";

const permissionSelect = {
  id: true,
  key: true,
  domain: true,
  resource: true,
  action: true,
  description: true,
  riskClassification: true,
  active: true,
  deprecatedAt: true,
  replacementPermissionKey: true,
  definitionVersion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PermissionSelect;

const rolePermissionSelect = {
  id: true,
  organizationId: true,
  roleId: true,
  permissionId: true,
  scopeType: true,
  scopeBindingType: true,
  scopeBindingId: true,
  grantedByEmployeeId: true,
  grantedAt: true,
  effectiveAt: true,
  expiresAt: true,
  removedAt: true,
  removedByEmployeeId: true,
  createdAt: true,
  updatedAt: true,
  permission: { select: permissionSelect },
  role: { select: { archivedAt: true } },
} satisfies Prisma.RolePermissionSelect;

type RawPermission = Prisma.PermissionGetPayload<{
  select: typeof permissionSelect;
}>;
type RawRolePermission = Prisma.RolePermissionGetPayload<{
  select: typeof rolePermissionSelect;
}>;

interface LockedRole {
  readonly id: string;
  readonly archivedAt: Date | null;
}

interface LockedEmployee {
  readonly id: string;
  readonly displayName: string;
  readonly employeeCode: string;
}

interface LockedRolePermission {
  readonly id: string;
  readonly scopeType: ScopeType;
  readonly scopeBindingType: string | null;
  readonly scopeBindingId: string | null;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
  readonly removedAt: Date | null;
}

function permissionView(permission: RawPermission): PermissionView {
  return permission;
}

function definitionRecord(
  permission: RawPermission,
): PermissionDefinitionRecord {
  return permission;
}

function rolePermissionView(
  grant: RawRolePermission,
  at: Date,
): RolePermissionView {
  const definition = canonicalPermissionDefinition(grant.permission.key);
  return {
    id: grant.id,
    organizationId: grant.organizationId,
    roleId: grant.roleId,
    permissionId: grant.permissionId,
    permission: permissionView(grant.permission),
    scopeType: grant.scopeType as ScopeType,
    scopeBindingType: grant.scopeBindingType,
    scopeBindingId: grant.scopeBindingId,
    grantedByEmployeeId: grant.grantedByEmployeeId,
    grantedAt: grant.grantedAt,
    effectiveAt: grant.effectiveAt,
    expiresAt: grant.expiresAt,
    removedAt: grant.removedAt,
    removedByEmployeeId: grant.removedByEmployeeId,
    effective:
      definition !== null &&
      permissionRecordCanBackGrant(
        definitionRecord(grant.permission),
        definition,
      ) &&
      grant.effectiveAt.getTime() <= at.getTime() &&
      grant.removedAt === null &&
      (grant.expiresAt === null || at.getTime() < grant.expiresAt.getTime()) &&
      grant.role.archivedAt === null,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  };
}

function actorSnapshot(employee: LockedEmployee): HistoricalActorSnapshot {
  return {
    type: "employee",
    displayName: employee.displayName,
    employeeCode: employee.employeeCode,
  };
}

function sameNullableDate(left: Date | null, right: Date | null): boolean {
  return (
    left?.getTime() === right?.getTime() || (left === null && right === null)
  );
}

@Injectable()
export class PrismaPermissionRepository implements PermissionRepositoryPort {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AUDIT_EVENT_APPEND_PORT)
    private readonly audit: AuditEventAppendPort,
    @Inject(SECURITY_EVENT_APPEND_PORT)
    private readonly security: SecurityEventAppendPort,
    @Inject(REQUEST_CONTEXT_STORE)
    private readonly contextStore: RequestContextStore,
  ) {}

  async list(page: number, pageSize: number): Promise<PermissionPage> {
    const canonicalKeys = PERMISSION_REGISTRY.map(({ key }) => key);
    const where = { key: { in: canonicalKeys } };
    const [total, permissions] = await this.client.$transaction([
      this.client.permission.count({ where }),
      this.client.permission.findMany({
        where,
        orderBy: [{ domain: "asc" }, { resource: "asc" }, { action: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: permissionSelect,
      }),
    ]);
    return { items: permissions.map(permissionView), page, pageSize, total };
  }

  async listRolePermissions(
    organizationId: string,
    roleId: string,
    page: number,
    pageSize: number,
    at: Date,
  ): Promise<RolePermissionPage | null> {
    const role = await this.client.role.findFirst({
      where: { organizationId, id: roleId },
      select: { id: true },
    });
    if (!role) return null;
    const where = { organizationId, roleId };
    const [total, grants] = await this.client.$transaction([
      this.client.rolePermission.count({ where }),
      this.client.rolePermission.findMany({
        where,
        orderBy: [
          { effectiveAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: rolePermissionSelect,
      }),
    ]);
    return {
      items: grants.map((grant) => rolePermissionView(grant, at)),
      page,
      pageSize,
      total,
    };
  }

  grant(input: Parameters<PermissionRepositoryPort["grant"]>[0]) {
    return runInTransaction(this.client, async (transaction) => {
      // Lock order shared with T05 archive: Role -> matching RolePermission rows.
      const role = await this.lockRole(
        transaction,
        input.actor.organizationId,
        input.roleId,
      );
      if (!role) return { status: "not_found" } as const;
      if (role.archivedAt) return { status: "archived" } as const;
      const permission = await transaction.permission.findUnique({
        where: { key: input.definition.key },
        select: permissionSelect,
      });
      if (
        !permission ||
        !permissionRecordCanBackGrant(
          definitionRecord(permission),
          input.definition,
        )
      ) {
        return { status: "permission_unavailable" } as const;
      }
      const grants = await this.lockRolePermissions(
        transaction,
        input.actor.organizationId,
        input.roleId,
        permission.id,
      );
      const effective = grants.find(
        (grant) =>
          grant.effectiveAt.getTime() <= input.effectiveAt.getTime() &&
          grant.removedAt === null &&
          (grant.expiresAt === null ||
            input.effectiveAt.getTime() < grant.expiresAt.getTime()),
      );
      if (effective) {
        const sameGrant =
          effective.scopeType === input.grant.scopeType &&
          effective.scopeBindingType === input.grant.scopeBindingType &&
          effective.scopeBindingId === input.grant.scopeBindingId &&
          sameNullableDate(effective.expiresAt, input.grant.expiresAt);
        if (!sameGrant) return { status: "conflict" } as const;
        return {
          status: "idempotent",
          grant: await this.requireRolePermission(
            transaction,
            effective.id,
            input.effectiveAt,
          ),
        } as const;
      }
      const actor = await this.requireEmployee(
        transaction,
        input.actor.organizationId,
        input.actor.employeeId,
      );
      const created = await transaction.rolePermission.create({
        data: {
          organizationId: input.actor.organizationId,
          roleId: input.roleId,
          permissionId: permission.id,
          scopeType: input.grant.scopeType,
          scopeBindingType: input.grant.scopeBindingType,
          scopeBindingId: input.grant.scopeBindingId,
          grantedByEmployeeId: input.actor.employeeId,
          grantedAt: input.effectiveAt,
          effectiveAt: input.effectiveAt,
          expiresAt: input.grant.expiresAt,
        },
        select: rolePermissionSelect,
      });
      await this.appendGrantHistory(transaction, input, created, actor);
      return {
        status: "granted",
        grant: rolePermissionView(created, input.effectiveAt),
      } as const;
    });
  }

  remove(input: Parameters<PermissionRepositoryPort["remove"]>[0]) {
    return runInTransaction(this.client, async (transaction) => {
      const role = await this.lockRole(
        transaction,
        input.actor.organizationId,
        input.roleId,
      );
      if (!role) return { status: "not_found" } as const;
      const permission = await transaction.permission.findUnique({
        where: { key: input.definition.key },
        select: permissionSelect,
      });
      if (!permission) return { status: "not_found" } as const;
      const grants = await this.lockRolePermissions(
        transaction,
        input.actor.organizationId,
        input.roleId,
        permission.id,
      );
      const effective =
        role.archivedAt === null
          ? grants.find(
              (grant) =>
                grant.effectiveAt.getTime() <= input.removedAt.getTime() &&
                grant.removedAt === null &&
                (grant.expiresAt === null ||
                  input.removedAt.getTime() < grant.expiresAt.getTime()),
            )
          : undefined;
      if (!effective) {
        const latest = grants[0];
        if (!latest) return { status: "not_found" } as const;
        return {
          status: "idempotent",
          grant: await this.requireRolePermission(
            transaction,
            latest.id,
            input.removedAt,
          ),
        } as const;
      }
      const actor = await this.requireEmployee(
        transaction,
        input.actor.organizationId,
        input.actor.employeeId,
      );
      const removed = await transaction.rolePermission.update({
        where: { id: effective.id },
        data: {
          removedAt: input.removedAt,
          removedByEmployeeId: input.actor.employeeId,
        },
        select: rolePermissionSelect,
      });
      await this.appendRemovalHistory(transaction, input, removed, actor);
      return {
        status: "removed",
        grant: rolePermissionView(removed, input.removedAt),
      } as const;
    });
  }

  async listEffectivePermissionGrantsForEmployee(
    organizationId: string,
    employeeId: string,
    at: Date,
  ): Promise<readonly EffectivePermissionGrant[]> {
    const grants = await this.client.rolePermission.findMany({
      where: {
        organizationId,
        effectiveAt: { lte: at },
        removedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
        permission: { active: true, deprecatedAt: null },
        role: {
          archivedAt: null,
          assignments: {
            some: {
              organizationId,
              employeeId,
              effectiveAt: { lte: at },
              removedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
            },
          },
        },
      },
      orderBy: [
        { roleId: "asc" },
        { permission: { key: "asc" } },
        { id: "asc" },
      ],
      select: rolePermissionSelect,
    });
    return grants.flatMap((grant) => {
      const definition = canonicalPermissionDefinition(grant.permission.key);
      if (
        !definition ||
        !permissionRecordCanBackGrant(
          definitionRecord(grant.permission),
          definition,
        )
      ) {
        return [];
      }
      return [
        {
          organizationId,
          employeeId,
          roleId: grant.roleId,
          rolePermissionId: grant.id,
          permissionKey: grant.permission.key,
          riskClassification: grant.permission.riskClassification,
          scopeType: grant.scopeType as ScopeType,
          scopeBindingType: grant.scopeBindingType,
          scopeBindingId: grant.scopeBindingId,
          effectiveAt: grant.effectiveAt,
          expiresAt: grant.expiresAt,
        },
      ];
    });
  }

  synchronizeRegistry(
    definitions: readonly PermissionDefinition[],
    occurredAt: Date,
  ) {
    return runInTransaction(this.client, async (transaction) => {
      let registered = 0;
      let metadataUpdated = 0;
      let unchanged = 0;
      for (const definition of definitions) {
        const existing = await transaction.permission.findUnique({
          where: { key: definition.key },
          select: permissionSelect,
        });
        if (!existing) {
          const created = await transaction.permission.create({
            data: definition,
            select: permissionSelect,
          });
          await this.audit.append(
            {
              actionKey: AUDIT_ACTION_KEYS.permissionRegistered,
              actorSnapshot: { type: "system" },
              targetType: "permission",
              targetId: created.key,
              changeDelta: {
                changedFields: [
                  "action",
                  "active",
                  "definitionVersion",
                  "description",
                  "domain",
                  "permissionKey",
                  "resource",
                  "riskClassification",
                ],
              },
              ...this.historyContext(),
              occurredAt,
            },
            transaction,
          );
          await this.outbox(
            transaction,
            PERMISSION_EVENT_CONTRACTS.permissionRegistered,
            undefined,
            {
              permissionKey: created.key,
              domain: created.domain,
              resource: created.resource,
              action: created.action,
              riskClassification: created.riskClassification,
              definitionVersion: created.definitionVersion,
              occurredAt: occurredAt.toISOString(),
            },
            occurredAt,
          );
          registered += 1;
          continue;
        }
        if (!this.safeMetadataCompatible(existing, definition)) {
          throw new PermissionRegistryDriftError(
            `Incompatible definition for ${definition.key}`,
          );
        }
        if (existing.description !== definition.description) {
          await transaction.permission.update({
            where: { id: existing.id },
            data: { description: definition.description },
          });
          metadataUpdated += 1;
        } else {
          unchanged += 1;
        }
      }
      return { registered, metadataUpdated, unchanged };
    });
  }

  async validateRegistry(definitions: readonly PermissionDefinition[]) {
    const [permissions, grantReferences] = await this.client.$transaction([
      this.client.permission.findMany({ select: permissionSelect }),
      this.client.rolePermission.findMany({
        select: { id: true, permission: { select: permissionSelect } },
      }),
    ]);
    return validatePermissionRegistryRecords(
      definitions,
      permissions,
      grantReferences,
    );
  }

  private safeMetadataCompatible(
    existing: RawPermission,
    definition: PermissionDefinition,
  ): boolean {
    return (
      existing.key === definition.key &&
      existing.domain === definition.domain &&
      existing.resource === definition.resource &&
      existing.action === definition.action &&
      existing.riskClassification === definition.riskClassification &&
      existing.active === definition.active &&
      existing.deprecatedAt === definition.deprecatedAt &&
      existing.replacementPermissionKey ===
        definition.replacementPermissionKey &&
      existing.definitionVersion === definition.definitionVersion
    );
  }

  private async appendGrantHistory(
    transaction: DatabaseTransaction,
    input: Parameters<PermissionRepositoryPort["grant"]>[0],
    created: RawRolePermission,
    actor: LockedEmployee,
  ): Promise<void> {
    const context = this.historyContext();
    await this.audit.append(
      {
        organizationId: input.actor.organizationId,
        actionKey: AUDIT_ACTION_KEYS.rolePermissionGranted,
        actorEmployeeId: input.actor.employeeId,
        actorSnapshot: actorSnapshot(actor),
        targetType: "role-permission",
        targetId: created.id,
        changeDelta: {
          changedFields: [
            "effectiveAt",
            "expiresAt",
            "permissionKey",
            "roleId",
            "scopeBindingId",
            "scopeBindingType",
            "scopeType",
          ],
        },
        ...context,
        occurredAt: input.effectiveAt,
      },
      transaction,
    );
    await this.security.append(
      {
        organizationId: input.actor.organizationId,
        eventType: SECURITY_EVENT_TYPES.rolePermissionGranted,
        category: "permission_administration",
        risk: "CRITICAL",
        outcome: "GRANTED",
        actorEmployeeId: input.actor.employeeId,
        actorSnapshot: actorSnapshot(actor),
        safeContext: {
          roleId: input.roleId,
          rolePermissionId: created.id,
          permissionKey: input.definition.key,
          scopeType: input.grant.scopeType,
          scopeBindingType: input.grant.scopeBindingType,
          scopeBindingId: input.grant.scopeBindingId,
        },
        ...context,
        occurredAt: input.effectiveAt,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      PERMISSION_EVENT_CONTRACTS.rolePermissionGranted,
      input.actor.organizationId,
      {
        organizationId: input.actor.organizationId,
        roleId: input.roleId,
        rolePermissionId: created.id,
        permissionKey: input.definition.key,
        scopeType: input.grant.scopeType,
        scopeBindingType: input.grant.scopeBindingType,
        scopeBindingId: input.grant.scopeBindingId,
        effectiveAt: input.effectiveAt.toISOString(),
        expiresAt: input.grant.expiresAt?.toISOString() ?? null,
        occurredAt: input.effectiveAt.toISOString(),
      },
      input.effectiveAt,
      context,
    );
  }

  private async appendRemovalHistory(
    transaction: DatabaseTransaction,
    input: Parameters<PermissionRepositoryPort["remove"]>[0],
    removed: RawRolePermission,
    actor: LockedEmployee,
  ): Promise<void> {
    const context = this.historyContext();
    await this.audit.append(
      {
        organizationId: input.actor.organizationId,
        actionKey: AUDIT_ACTION_KEYS.rolePermissionRemoved,
        actorEmployeeId: input.actor.employeeId,
        actorSnapshot: actorSnapshot(actor),
        targetType: "role-permission",
        targetId: removed.id,
        changeDelta: { changedFields: ["removedAt", "removedByEmployeeId"] },
        ...context,
        occurredAt: input.removedAt,
      },
      transaction,
    );
    await this.security.append(
      {
        organizationId: input.actor.organizationId,
        eventType: SECURITY_EVENT_TYPES.rolePermissionRemoved,
        category: "permission_administration",
        risk: "CRITICAL",
        outcome: "REMOVED",
        actorEmployeeId: input.actor.employeeId,
        actorSnapshot: actorSnapshot(actor),
        safeContext: {
          roleId: input.roleId,
          rolePermissionId: removed.id,
          permissionKey: input.definition.key,
          scopeType: removed.scopeType,
        },
        ...context,
        occurredAt: input.removedAt,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      PERMISSION_EVENT_CONTRACTS.rolePermissionRemoved,
      input.actor.organizationId,
      {
        organizationId: input.actor.organizationId,
        roleId: input.roleId,
        rolePermissionId: removed.id,
        permissionKey: input.definition.key,
        occurredAt: input.removedAt.toISOString(),
      },
      input.removedAt,
      context,
    );
  }

  private async lockRole(
    transaction: DatabaseTransaction,
    organizationId: string,
    roleId: string,
  ): Promise<LockedRole | null> {
    const rows = await transaction.$queryRaw<LockedRole[]>(Prisma.sql`
      SELECT "id", "archived_at" AS "archivedAt"
      FROM "roles"
      WHERE "organization_id" = ${organizationId}::uuid AND "id" = ${roleId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private lockRolePermissions(
    transaction: DatabaseTransaction,
    organizationId: string,
    roleId: string,
    permissionId: string,
  ): Promise<LockedRolePermission[]> {
    return transaction.$queryRaw<LockedRolePermission[]>(Prisma.sql`
      SELECT "id", "scope_type" AS "scopeType",
        "scope_binding_type" AS "scopeBindingType", "scope_binding_id" AS "scopeBindingId",
        "effective_at" AS "effectiveAt", "expires_at" AS "expiresAt", "removed_at" AS "removedAt"
      FROM "role_permissions"
      WHERE "organization_id" = ${organizationId}::uuid
        AND "role_id" = ${roleId}::uuid
        AND "permission_id" = ${permissionId}::uuid
      ORDER BY "effective_at" DESC, "created_at" DESC, "id" DESC
      FOR UPDATE
    `);
  }

  private async requireEmployee(
    transaction: DatabaseTransaction,
    organizationId: string,
    employeeId: string,
  ): Promise<LockedEmployee> {
    const employee = await transaction.employee.findFirst({
      where: { organizationId, id: employeeId },
      select: { id: true, displayName: true, employeeCode: true },
    });
    if (!employee) throw new Error("Trusted permission actor was not found");
    return employee;
  }

  private async requireRolePermission(
    transaction: DatabaseTransaction,
    rolePermissionId: string,
    at: Date,
  ): Promise<RolePermissionView> {
    const grant = await transaction.rolePermission.findUniqueOrThrow({
      where: { id: rolePermissionId },
      select: rolePermissionSelect,
    });
    return rolePermissionView(grant, at);
  }

  private historyContext(): {
    readonly requestId?: string;
    readonly correlationId: string;
  } {
    const context = this.contextStore.get();
    return {
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      correlationId: context?.correlationId ?? randomUUID(),
    };
  }

  private outbox(
    transaction: DatabaseTransaction,
    contract: { readonly eventType: string; readonly eventVersion: number },
    organizationId: string | undefined,
    payload: unknown,
    occurredAt: Date,
    providedContext?: {
      readonly requestId?: string;
      readonly correlationId: string;
    },
  ) {
    const context = providedContext ?? this.historyContext();
    return persistOutboxEvent(transaction, {
      eventType: contract.eventType,
      eventVersion: contract.eventVersion,
      payload,
      ...(organizationId ? { organizationId } : {}),
      correlationId: context.correlationId,
      ...(context.requestId ? { causationId: context.requestId } : {}),
      occurredAt,
    });
  }
}
