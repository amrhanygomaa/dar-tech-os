import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CLIENT,
  Prisma,
  runInTransaction,
  type DatabaseClient,
  type DatabaseTransaction,
} from '@dar-tech/database';
import { REQUEST_CONTEXT_STORE, type RequestContextStore } from '@dar-tech/observability';
import { persistOutboxEvent } from '@dar-tech/outbox';
import {
  AUDIT_ACTION_KEYS,
  AUDIT_EVENT_APPEND_PORT,
  type AuditEventAppendPort,
  type HistoricalActorSnapshot,
} from '../event-history/event-history.contracts.js';
import type {
  EmployeeRoleView,
  RolePage,
  RoleRepositoryPort,
  RoleView,
} from './role.contracts.js';
import { ROLE_EVENT_CONTRACTS } from './role.events.js';

const roleSelect = {
  id: true,
  organizationId: true,
  key: true,
  name: true,
  normalizedName: true,
  description: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RoleSelect;

const employeeRoleSelect = {
  id: true,
  organizationId: true,
  employeeId: true,
  roleId: true,
  assignedByEmployeeId: true,
  assignedAt: true,
  effectiveAt: true,
  expiresAt: true,
  removedAt: true,
  removedByEmployeeId: true,
  safeRemovalReason: true,
  createdAt: true,
  updatedAt: true,
  role: { select: roleSelect },
} satisfies Prisma.EmployeeRoleSelect;

type RawRole = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;
type RawEmployeeRole = Prisma.EmployeeRoleGetPayload<{ select: typeof employeeRoleSelect }>;

interface LockedEmployee {
  readonly id: string;
  readonly organizationId: string;
  readonly displayName: string;
  readonly employeeCode: string;
}

interface LockedEmployeeRole {
  readonly id: string;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
  readonly removedAt: Date | null;
}

function roleView(role: RawRole): RoleView {
  return { ...role, archived: role.archivedAt !== null };
}

function assignmentView(assignment: RawEmployeeRole, at: Date): EmployeeRoleView {
  return {
    ...assignment,
    role: roleView(assignment.role),
    effective:
      assignment.effectiveAt.getTime() <= at.getTime() &&
      assignment.removedAt === null &&
      (assignment.expiresAt === null || at.getTime() < assignment.expiresAt.getTime()) &&
      assignment.role.archivedAt === null,
  };
}

function actorSnapshot(employee: LockedEmployee): HistoricalActorSnapshot {
  return {
    type: 'employee',
    displayName: employee.displayName,
    employeeCode: employee.employeeCode,
  };
}

@Injectable()
export class PrismaRoleRepository implements RoleRepositoryPort {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AUDIT_EVENT_APPEND_PORT) private readonly audit: AuditEventAppendPort,
    @Inject(REQUEST_CONTEXT_STORE) private readonly contextStore: RequestContextStore,
  ) {}

  async list(organizationId: string, page: number, pageSize: number): Promise<RolePage> {
    const [total, roles] = await this.client.$transaction([
      this.client.role.count({ where: { organizationId } }),
      this.client.role.findMany({
        where: { organizationId },
        orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: roleSelect,
      }),
    ]);
    return { items: roles.map(roleView), page, pageSize, total };
  }

  create(input: Parameters<RoleRepositoryPort['create']>[0]): Promise<RoleView> {
    return runInTransaction(this.client, async (transaction) => {
      const actor = await this.requireEmployee(
        transaction,
        input.actor.organizationId,
        input.actor.employeeId,
      );
      const role = await transaction.role.create({
        data: {
          organizationId: input.actor.organizationId,
          key: input.role.key,
          name: input.role.name,
          normalizedName: input.role.normalizedName,
          description: input.role.description,
        },
        select: roleSelect,
      });
      await this.audit.append(
        {
          organizationId: role.organizationId,
          actionKey: AUDIT_ACTION_KEYS.roleCreated,
          actorEmployeeId: input.actor.employeeId,
          actorSnapshot: actorSnapshot(actor),
          targetType: 'role',
          targetId: role.id,
          targetSnapshot: { displayName: role.name },
          changeDelta: { changedFields: ['description', 'key', 'name'] },
          ...this.historyContext(),
          occurredAt: input.occurredAt,
        },
        transaction,
      );
      await this.outbox(
        transaction,
        ROLE_EVENT_CONTRACTS.roleCreated,
        role.organizationId,
        { organizationId: role.organizationId, roleId: role.id, occurredAt: input.occurredAt.toISOString() },
        input.occurredAt,
      );
      return roleView(role);
    });
  }

  update(input: Parameters<RoleRepositoryPort['update']>[0]) {
    return runInTransaction(this.client, async (transaction) => {
      const locked = await this.lockRole(transaction, input.actor.organizationId, input.roleId);
      if (!locked) return { status: 'not_found' } as const;
      const changedFields = Object.entries(input.patch)
        .filter(([field, value]) => locked[field as keyof RawRole] !== value)
        .map(([field]) => field)
        .filter((field) => field !== 'normalizedName')
        .sort();
      if (changedFields.length === 0) {
        return { status: 'idempotent', role: roleView(locked) } as const;
      }
      const actor = await this.requireEmployee(
        transaction,
        input.actor.organizationId,
        input.actor.employeeId,
      );
      const role = await transaction.role.update({
        where: { id: locked.id },
        data: input.patch,
        select: roleSelect,
      });
      await this.audit.append(
        {
          organizationId: role.organizationId,
          actionKey: AUDIT_ACTION_KEYS.roleUpdated,
          actorEmployeeId: input.actor.employeeId,
          actorSnapshot: actorSnapshot(actor),
          targetType: 'role',
          targetId: role.id,
          targetSnapshot: { displayName: locked.name },
          changeDelta: { changedFields },
          ...this.historyContext(),
          occurredAt: input.occurredAt,
        },
        transaction,
      );
      await this.outbox(
        transaction,
        ROLE_EVENT_CONTRACTS.roleUpdated,
        role.organizationId,
        { organizationId: role.organizationId, roleId: role.id, occurredAt: input.occurredAt.toISOString() },
        input.occurredAt,
      );
      return { status: 'changed', role: roleView(role) } as const;
    });
  }

  archive(input: Parameters<RoleRepositoryPort['archive']>[0]) {
    return runInTransaction(this.client, async (transaction) => {
      const locked = await this.lockRole(transaction, input.actor.organizationId, input.roleId);
      if (!locked) return { status: 'not_found' } as const;
      if (locked.archivedAt) {
        return { status: 'idempotent', role: roleView(locked) } as const;
      }
      const actor = await this.requireEmployee(
        transaction,
        input.actor.organizationId,
        input.actor.employeeId,
      );
      const role = await transaction.role.update({
        where: { id: locked.id },
        data: { archivedAt: input.occurredAt },
        select: roleSelect,
      });
      await this.audit.append(
        {
          organizationId: role.organizationId,
          actionKey: AUDIT_ACTION_KEYS.roleArchived,
          actorEmployeeId: input.actor.employeeId,
          actorSnapshot: actorSnapshot(actor),
          targetType: 'role',
          targetId: role.id,
          targetSnapshot: { displayName: role.name },
          changeDelta: { changedFields: ['archivedAt'] },
          ...this.historyContext(),
          occurredAt: input.occurredAt,
        },
        transaction,
      );
      await this.outbox(
        transaction,
        ROLE_EVENT_CONTRACTS.roleArchived,
        role.organizationId,
        { organizationId: role.organizationId, roleId: role.id, occurredAt: input.occurredAt.toISOString() },
        input.occurredAt,
      );
      return { status: 'changed', role: roleView(role) } as const;
    });
  }

  assign(input: Parameters<RoleRepositoryPort['assign']>[0]) {
    return runInTransaction(this.client, async (transaction) => {
      const role = await this.lockRole(transaction, input.actor.organizationId, input.roleId);
      if (!role) return { status: 'not_found' } as const;
      if (role.archivedAt) return { status: 'archived' } as const;
      const employee = await this.lockEmployee(
        transaction,
        input.actor.organizationId,
        input.employeeId,
      );
      if (!employee) return { status: 'not_found' } as const;
      const assignments = await this.lockAssignments(
        transaction,
        input.actor.organizationId,
        input.employeeId,
        input.roleId,
      );
      const effective = assignments.find(
        (assignment) =>
          assignment.effectiveAt.getTime() <= input.effectiveAt.getTime() &&
          assignment.removedAt === null &&
          (assignment.expiresAt === null || input.effectiveAt.getTime() < assignment.expiresAt.getTime()),
      );
      if (effective) {
        const sameExpiry =
          effective.expiresAt?.getTime() === input.expiresAt?.getTime() ||
          (effective.expiresAt === null && input.expiresAt === null);
        if (!sameExpiry) return { status: 'conflict' } as const;
        return {
          status: 'idempotent',
          assignment: await this.requireAssignment(transaction, effective.id, input.effectiveAt),
        } as const;
      }
      const actor = await this.requireEmployee(
        transaction,
        input.actor.organizationId,
        input.actor.employeeId,
      );
      const created = await transaction.employeeRole.create({
        data: {
          organizationId: input.actor.organizationId,
          employeeId: input.employeeId,
          roleId: input.roleId,
          assignedByEmployeeId: input.actor.employeeId,
          assignedAt: input.effectiveAt,
          effectiveAt: input.effectiveAt,
          expiresAt: input.expiresAt,
        },
        select: employeeRoleSelect,
      });
      await this.audit.append(
        {
          organizationId: input.actor.organizationId,
          actionKey: AUDIT_ACTION_KEYS.employeeRoleAssigned,
          actorEmployeeId: input.actor.employeeId,
          actorSnapshot: actorSnapshot(actor),
          targetType: 'employee-role',
          targetId: created.id,
          targetSnapshot: {
            displayName: employee.displayName,
            employeeCode: employee.employeeCode,
          },
          changeDelta: { changedFields: ['effectiveAt', 'expiresAt', 'roleId'] },
          ...this.historyContext(),
          occurredAt: input.effectiveAt,
        },
        transaction,
      );
      await this.outbox(
        transaction,
        ROLE_EVENT_CONTRACTS.employeeRoleAssigned,
        input.actor.organizationId,
        {
          organizationId: input.actor.organizationId,
          roleId: input.roleId,
          employeeId: input.employeeId,
          employeeRoleId: created.id,
          effectiveAt: input.effectiveAt.toISOString(),
          expiresAt: input.expiresAt?.toISOString() ?? null,
          occurredAt: input.effectiveAt.toISOString(),
        },
        input.effectiveAt,
      );
      return { status: 'assigned', assignment: assignmentView(created, input.effectiveAt) } as const;
    });
  }

  remove(input: Parameters<RoleRepositoryPort['remove']>[0]) {
    return runInTransaction(this.client, async (transaction) => {
      const role = await this.lockRole(transaction, input.actor.organizationId, input.roleId);
      if (!role) return { status: 'not_found' } as const;
      const employee = await this.lockEmployee(
        transaction,
        input.actor.organizationId,
        input.employeeId,
      );
      if (!employee) return { status: 'not_found' } as const;
      const assignments = await this.lockAssignments(
        transaction,
        input.actor.organizationId,
        input.employeeId,
        input.roleId,
      );
      const effective = assignments.find(
        (assignment) =>
          assignment.effectiveAt.getTime() <= input.removedAt.getTime() &&
          assignment.removedAt === null &&
          (assignment.expiresAt === null || input.removedAt.getTime() < assignment.expiresAt.getTime()),
      );
      if (!effective) {
        const latest = assignments[0];
        if (!latest) return { status: 'not_found' } as const;
        return {
          status: 'idempotent',
          assignment: await this.requireAssignment(transaction, latest.id, input.removedAt),
        } as const;
      }
      const actor = await this.requireEmployee(
        transaction,
        input.actor.organizationId,
        input.actor.employeeId,
      );
      const removed = await transaction.employeeRole.update({
        where: { id: effective.id },
        data: {
          removedAt: input.removedAt,
          removedByEmployeeId: input.actor.employeeId,
        },
        select: employeeRoleSelect,
      });
      await this.audit.append(
        {
          organizationId: input.actor.organizationId,
          actionKey: AUDIT_ACTION_KEYS.employeeRoleRemoved,
          actorEmployeeId: input.actor.employeeId,
          actorSnapshot: actorSnapshot(actor),
          targetType: 'employee-role',
          targetId: removed.id,
          targetSnapshot: {
            displayName: employee.displayName,
            employeeCode: employee.employeeCode,
          },
          changeDelta: { changedFields: ['removedAt', 'removedByEmployeeId'] },
          ...this.historyContext(),
          occurredAt: input.removedAt,
        },
        transaction,
      );
      await this.outbox(
        transaction,
        ROLE_EVENT_CONTRACTS.employeeRoleRemoved,
        input.actor.organizationId,
        {
          organizationId: input.actor.organizationId,
          roleId: input.roleId,
          employeeId: input.employeeId,
          employeeRoleId: removed.id,
          effectiveAt: removed.effectiveAt.toISOString(),
          expiresAt: removed.expiresAt?.toISOString() ?? null,
          occurredAt: input.removedAt.toISOString(),
        },
        input.removedAt,
      );
      return { status: 'removed', assignment: assignmentView(removed, input.removedAt) } as const;
    });
  }

  async listEffectiveRolesForEmployee(
    organizationId: string,
    employeeId: string,
    at: Date,
  ): Promise<readonly EmployeeRoleView[]> {
    const assignments = await this.client.employeeRole.findMany({
      where: {
        organizationId,
        employeeId,
        effectiveAt: { lte: at },
        removedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
        role: { archivedAt: null },
      },
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
      select: employeeRoleSelect,
    });
    return assignments.map((assignment) => assignmentView(assignment, at));
  }

  private async lockRole(
    transaction: DatabaseTransaction,
    organizationId: string,
    roleId: string,
  ): Promise<RawRole | null> {
    const rows = await transaction.$queryRaw<RawRole[]>(Prisma.sql`
      SELECT
        "id", "organization_id" AS "organizationId", "role_key" AS "key", "name",
        "normalized_name" AS "normalizedName", "description", "archived_at" AS "archivedAt",
        "created_at" AS "createdAt", "updated_at" AS "updatedAt"
      FROM "roles"
      WHERE "organization_id" = ${organizationId}::uuid AND "id" = ${roleId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockEmployee(
    transaction: DatabaseTransaction,
    organizationId: string,
    employeeId: string,
  ): Promise<LockedEmployee | null> {
    const rows = await transaction.$queryRaw<LockedEmployee[]>(Prisma.sql`
      SELECT "id", "organization_id" AS "organizationId", "display_name" AS "displayName",
        "employee_code" AS "employeeCode"
      FROM "employees"
      WHERE "organization_id" = ${organizationId}::uuid AND "id" = ${employeeId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockAssignments(
    transaction: DatabaseTransaction,
    organizationId: string,
    employeeId: string,
    roleId: string,
  ): Promise<LockedEmployeeRole[]> {
    return transaction.$queryRaw<LockedEmployeeRole[]>(Prisma.sql`
      SELECT "id", "effective_at" AS "effectiveAt", "expires_at" AS "expiresAt",
        "removed_at" AS "removedAt"
      FROM "employee_roles"
      WHERE "organization_id" = ${organizationId}::uuid
        AND "employee_id" = ${employeeId}::uuid
        AND "role_id" = ${roleId}::uuid
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
      where: { id: employeeId, organizationId },
      select: { id: true, organizationId: true, displayName: true, employeeCode: true },
    });
    if (!employee) throw new Error('Trusted role actor was not found');
    return employee;
  }

  private async requireAssignment(
    transaction: DatabaseTransaction,
    assignmentId: string,
    at: Date,
  ): Promise<EmployeeRoleView> {
    const assignment = await transaction.employeeRole.findUniqueOrThrow({
      where: { id: assignmentId },
      select: employeeRoleSelect,
    });
    return assignmentView(assignment, at);
  }

  private historyContext(): { readonly requestId?: string; readonly correlationId: string } {
    const context = this.contextStore.get();
    return {
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      correlationId: context?.correlationId ?? randomUUID(),
    };
  }

  private outbox(
    transaction: DatabaseTransaction,
    contract: { readonly eventType: string; readonly eventVersion: number },
    organizationId: string,
    payload: unknown,
    occurredAt: Date,
  ) {
    const context = this.historyContext();
    return persistOutboxEvent(transaction, {
      eventType: contract.eventType,
      eventVersion: contract.eventVersion,
      payload,
      organizationId,
      correlationId: context.correlationId,
      ...(context.requestId ? { causationId: context.requestId } : {}),
      occurredAt,
    });
  }
}
