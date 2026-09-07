import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CLIENT,
  runInTransaction,
  type DatabaseClient,
  type DatabaseTransaction,
  type Prisma,
} from '@dar-tech/database';
import { REQUEST_CONTEXT_STORE, type RequestContextStore } from '@dar-tech/observability';
import { persistOutboxEvent } from '@dar-tech/outbox';
import {
  AUDIT_ACTION_KEYS,
  AUDIT_EVENT_APPEND_PORT,
  SECURITY_EVENT_APPEND_PORT,
  SECURITY_EVENT_TYPES,
  type AuditEventAppendPort,
  type SecurityEventAppendPort,
} from '../event-history/event-history.contracts.js';
import type { EmployeeDetailView } from '../identity/identity.contracts.js';
import { ROLE_EVENT_CONTRACTS } from '../roles/role.events.js';
import type {
  CleanupCounts,
  LockedLifecycleEmployee,
  OffboardingRepositoryPort,
} from './offboarding.contracts.js';
import { OFFBOARDING_EVENTS } from './offboarding.events.js';

const userAccountSelect = {
  id: true,
  organizationId: true,
  employeeId: true,
  authenticationEligible: true,
  activatedAt: true,
  disabledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserAccountSelect;

const employeeSelect = {
  id: true,
  organizationId: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  displayName: true,
  workEmail: true,
  lifecycleStatus: true,
  invitedAt: true,
  activatedAt: true,
  suspendedAt: true,
  offboardingAt: true,
  archivedAt: true,
  lifecycleVersion: true,
  offboardingSourceLifecycle: true,
  offboardingInitiatedByEmployeeId: true,
  offboardingReason: true,
  offboardingApprovalReference: true,
  offboardingCleanupStatus: true,
  offboardingCleanupAttemptedAt: true,
  offboardingCleanupCompletedAt: true,
  offboardingCleanupFailureCode: true,
  offboardingSessionsRevokedCount: true,
  offboardingRolesEndedCount: true,
  offboardingTemporaryAccessEndedCount: true,
  offboardingEmergencyAccessEndedCount: true,
  createdAt: true,
  updatedAt: true,
  userAccount: { select: userAccountSelect },
} satisfies Prisma.EmployeeSelect;

type RawEmployee = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

function employeeView(employee: RawEmployee): EmployeeDetailView {
  return employee;
}

@Injectable()
export class PrismaOffboardingRepository implements OffboardingRepositoryPort {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AUDIT_EVENT_APPEND_PORT) private readonly audit: AuditEventAppendPort,
    @Inject(SECURITY_EVENT_APPEND_PORT) private readonly security: SecurityEventAppendPort,
    @Inject(REQUEST_CONTEXT_STORE) private readonly context: RequestContextStore,
  ) {}

  transaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return runInTransaction(this.client, work);
  }

  async findEmployee(organizationId: string, employeeId: string): Promise<EmployeeDetailView | null> {
    const employee = await this.client.employee.findFirst({
      where: { organizationId, id: employeeId },
      select: employeeSelect,
    });
    return employee ? employeeView(employee) : null;
  }

  async lockEmployee(
    organizationId: string,
    employeeId: string,
    transaction: DatabaseTransaction,
  ): Promise<LockedLifecycleEmployee | null> {
    await transaction.$queryRaw`SELECT id FROM employees WHERE organization_id = ${organizationId}::uuid AND id = ${employeeId}::uuid FOR UPDATE`;
    const employee = await transaction.employee.findFirst({
      where: { organizationId, id: employeeId },
      select: employeeSelect,
    });
    if (!employee?.userAccount) return null;
    await transaction.$queryRaw`SELECT id FROM user_accounts WHERE organization_id = ${organizationId}::uuid AND employee_id = ${employeeId}::uuid FOR UPDATE`;
    return employeeView(employee) as LockedLifecycleEmployee;
  }

  async suspendBarrier(
    input: Parameters<OffboardingRepositoryPort['suspendBarrier']>[0],
    transaction: DatabaseTransaction,
  ): Promise<{ readonly changed: boolean; readonly employee: EmployeeDetailView }> {
    const changed = input.target.lifecycleStatus === 'ACTIVE';
    await this.disableAccount(transaction, input.target, input.at);
    if (changed) {
      await transaction.employee.update({
        where: { id: input.target.id },
        data: {
          lifecycleStatus: 'SUSPENDED',
          suspendedAt: input.at,
          lifecycleVersion: { increment: 1 },
        },
      });
      await this.recordTransition(
        transaction,
        input,
        AUDIT_ACTION_KEYS.employeeSuspended,
        SECURITY_EVENT_TYPES.employeeSuspended,
        OFFBOARDING_EVENTS.employeeSuspended,
        'ACTIVE',
        'SUSPENDED',
        ['authenticationEligible', 'disabledAt', 'lifecycleStatus', 'lifecycleVersion', 'suspendedAt'],
      );
    } else if (
      input.target.userAccount.authenticationEligible ||
      input.target.userAccount.disabledAt === null
    ) {
      await this.audit.append({
        organizationId: input.actor.organizationId,
        actionKey: AUDIT_ACTION_KEYS.employeeSuspended,
        actorEmployeeId: input.actor.employeeId,
        actorSnapshot: await this.actorSnapshot(transaction, input.actor.organizationId, input.actor.employeeId),
        targetType: 'employee',
        targetId: input.target.id,
        targetSnapshot: this.targetSnapshot(input.target),
        safeReason: input.reason,
        changeDelta: { changedFields: ['authenticationEligible', 'disabledAt'] },
        ...(input.approvalReference ? { approvalReference: input.approvalReference } : {}),
        ...this.history(input.correlationId),
        occurredAt: input.at,
      }, transaction);
    }
    return { changed, employee: await this.requireEmployee(transaction, input.target.organizationId, input.target.id) };
  }

  async startOffboarding(
    input: Parameters<OffboardingRepositoryPort['startOffboarding']>[0],
    transaction: DatabaseTransaction,
  ): Promise<EmployeeDetailView> {
    await this.disableAccount(transaction, input.target, input.at);
    await transaction.employee.update({
      where: { id: input.target.id },
      data: {
        lifecycleStatus: 'OFFBOARDING',
        offboardingAt: input.at,
        offboardingSourceLifecycle: input.sourceLifecycle,
        offboardingInitiatedByEmployeeId: input.actor.employeeId,
        offboardingReason: input.reason,
        offboardingApprovalReference: input.approvalReference,
        offboardingCleanupStatus: 'PENDING',
        offboardingCleanupAttemptedAt: null,
        offboardingCleanupCompletedAt: null,
        offboardingCleanupFailureCode: null,
        offboardingSessionsRevokedCount: 0,
        offboardingRolesEndedCount: 0,
        offboardingTemporaryAccessEndedCount: 0,
        offboardingEmergencyAccessEndedCount: 0,
        lifecycleVersion: { increment: 1 },
      },
    });
    await this.recordTransition(
      transaction,
      input,
      AUDIT_ACTION_KEYS.employeeOffboardingStarted,
      SECURITY_EVENT_TYPES.employeeOffboardingStarted,
      OFFBOARDING_EVENTS.offboardingStarted,
      input.sourceLifecycle,
      'OFFBOARDING',
      [
        'authenticationEligible',
        'disabledAt',
        'lifecycleStatus',
        'lifecycleVersion',
        'offboardingApprovalReference',
        'offboardingCleanupStatus',
        'offboardingInitiatedByEmployeeId',
        'offboardingReason',
        'offboardingSourceLifecycle',
      ],
    );
    return this.requireEmployee(transaction, input.target.organizationId, input.target.id);
  }

  async endRoleAssignments(
    input: Parameters<OffboardingRepositoryPort['endRoleAssignments']>[0],
    transaction: DatabaseTransaction,
  ): Promise<number> {
    const references = await transaction.employeeRole.findMany({
      where: {
        organizationId: input.actor.organizationId,
        employeeId: input.target.id,
        removedAt: null,
        effectiveAt: { lte: input.at },
        OR: [{ expiresAt: null }, { expiresAt: { gt: input.at } }],
        role: { archivedAt: null },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    let ended = 0;
    for (const reference of references) {
      await transaction.$queryRaw`SELECT id FROM employee_roles WHERE organization_id = ${input.actor.organizationId}::uuid AND id = ${reference.id}::uuid FOR UPDATE`;
      const assignment = await transaction.employeeRole.findFirst({
        where: {
          id: reference.id,
          organizationId: input.actor.organizationId,
          employeeId: input.target.id,
          removedAt: null,
          effectiveAt: { lte: input.at },
          OR: [{ expiresAt: null }, { expiresAt: { gt: input.at } }],
          role: { archivedAt: null },
        },
        select: { id: true, roleId: true, effectiveAt: true, expiresAt: true },
      });
      if (!assignment) continue;
      await transaction.employeeRole.update({
        where: { id: assignment.id },
        data: {
          removedAt: input.at,
          removedByEmployeeId: input.actor.employeeId,
          safeRemovalReason: 'employee_offboarding',
        },
      });
      await this.audit.append({
        organizationId: input.actor.organizationId,
        actionKey: AUDIT_ACTION_KEYS.employeeRoleRemoved,
        actorEmployeeId: input.actor.employeeId,
        actorSnapshot: await this.actorSnapshot(transaction, input.actor.organizationId, input.actor.employeeId),
        targetType: 'employee-role',
        targetId: assignment.id,
        targetSnapshot: this.targetSnapshot(input.target),
        safeReason: 'employee_offboarding',
        changeDelta: { changedFields: ['removedAt', 'removedByEmployeeId'] },
        ...this.history(input.correlationId),
        occurredAt: input.at,
      }, transaction);
      await this.outbox(transaction, ROLE_EVENT_CONTRACTS.employeeRoleRemoved, input.actor.organizationId, {
        organizationId: input.actor.organizationId,
        roleId: assignment.roleId,
        employeeId: input.target.id,
        employeeRoleId: assignment.id,
        effectiveAt: assignment.effectiveAt.toISOString(),
        expiresAt: assignment.expiresAt?.toISOString() ?? null,
        occurredAt: input.at.toISOString(),
      }, input.correlationId, input.at);
      ended += 1;
    }
    return ended;
  }

  async completeCleanup(
    input: Parameters<OffboardingRepositoryPort['completeCleanup']>[0],
    transaction: DatabaseTransaction,
  ): Promise<EmployeeDetailView> {
    const current = await this.lockEmployee(input.actor.organizationId, input.target.id, transaction);
    if (!current) throw new Error('Offboarding target is unavailable');
    if (current.offboardingCleanupStatus === 'COMPLETED') return current;
    if (
      current.lifecycleStatus !== 'OFFBOARDING' ||
      current.userAccount.authenticationEligible ||
      current.userAccount.disabledAt === null
    ) throw new Error('Offboarding security barrier is unavailable');
    const [sessions, roles, temporary, emergency] = await Promise.all([
      transaction.session.count({ where: { organizationId: current.organizationId, employeeId: current.id, revokedAt: null } }),
      transaction.employeeRole.count({
        where: {
          organizationId: current.organizationId,
          employeeId: current.id,
          removedAt: null,
          effectiveAt: { lte: input.at },
          OR: [{ expiresAt: null }, { expiresAt: { gt: input.at } }],
          role: { archivedAt: null },
        },
      }),
      transaction.temporaryAccessGrant.count({ where: { organizationId: current.organizationId, recipientEmployeeId: current.id, status: { in: ['PENDING_APPROVAL', 'GRANTED'] } } }),
      transaction.emergencyAccessGrant.count({ where: { organizationId: current.organizationId, recipientEmployeeId: current.id, status: { in: ['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE', 'ACTIVE'] } } }),
    ]);
    if (sessions + roles + temporary + emergency !== 0) throw new Error('Offboarding cleanup verification failed');
    const counts: CleanupCounts = {
      ...input.counts,
      sessionsRevoked: (current.offboardingSessionsRevokedCount ?? 0) + input.counts.sessionsRevoked,
    };
    await transaction.employee.update({
      where: { id: current.id },
      data: {
        offboardingCleanupStatus: 'COMPLETED',
        offboardingCleanupAttemptedAt: input.at,
        offboardingCleanupCompletedAt: input.at,
        offboardingCleanupFailureCode: null,
        offboardingSessionsRevokedCount: counts.sessionsRevoked,
        offboardingRolesEndedCount: counts.rolesEnded,
        offboardingTemporaryAccessEndedCount: counts.temporaryAccessEnded,
        offboardingEmergencyAccessEndedCount: counts.emergencyAccessEnded,
      },
    });
    const actor = await this.actorSnapshot(transaction, input.actor.organizationId, input.actor.employeeId);
    await this.audit.append({
      organizationId: current.organizationId,
      actionKey: AUDIT_ACTION_KEYS.employeeOffboardingCleanup,
      actorEmployeeId: input.actor.employeeId,
      actorSnapshot: actor,
      targetType: 'employee',
      targetId: current.id,
      targetSnapshot: this.targetSnapshot(current),
      safeReason: current.offboardingReason ?? 'employee_offboarding',
      changeDelta: { changedFields: [
        'offboardingCleanupAttemptedAt',
        'offboardingCleanupCompletedAt',
        'offboardingCleanupStatus',
        'offboardingEmergencyAccessEndedCount',
        'offboardingRolesEndedCount',
        'offboardingSessionsRevokedCount',
        'offboardingTemporaryAccessEndedCount',
      ] },
      ...(current.offboardingApprovalReference ? { approvalReference: current.offboardingApprovalReference } : {}),
      ...this.history(input.correlationId),
      occurredAt: input.at,
    }, transaction);
    const safeContext = {
      targetEmployeeId: current.id,
      sessionsRevoked: counts.sessionsRevoked,
      rolesEnded: counts.rolesEnded,
      temporaryAccessEnded: counts.temporaryAccessEnded,
      emergencyAccessEnded: counts.emergencyAccessEnded,
      cleanupStatus: 'COMPLETED',
    } as const;
    for (const eventType of [SECURITY_EVENT_TYPES.employeeAccessRevoked, SECURITY_EVENT_TYPES.employeeOffboarded]) {
      await this.security.append({
        organizationId: current.organizationId,
        eventType,
        category: eventType === SECURITY_EVENT_TYPES.employeeAccessRevoked ? 'employee_access_revoked' : 'employee_offboarded',
        risk: 'HIGH',
        outcome: 'succeeded',
        actorEmployeeId: input.actor.employeeId,
        actorAccountId: input.actor.userAccountId,
        actorSnapshot: actor,
        safeContext,
        sessionReference: input.actor.sessionId,
        ...this.history(input.correlationId),
        occurredAt: input.at,
      }, transaction);
    }
    for (const contract of [OFFBOARDING_EVENTS.accessRevoked, OFFBOARDING_EVENTS.employeeOffboarded]) {
      await this.outbox(transaction, contract, current.organizationId, {
        organizationId: current.organizationId,
        employeeId: current.id,
        ...counts,
        occurredAt: input.at.toISOString(),
      }, input.correlationId, input.at);
    }
    return this.requireEmployee(transaction, current.organizationId, current.id);
  }

  async markCleanupIncomplete(
    input: Parameters<OffboardingRepositoryPort['markCleanupIncomplete']>[0],
  ): Promise<EmployeeDetailView> {
    return this.transaction(async (transaction) => {
      const current = await this.lockEmployee(input.organizationId, input.employeeId, transaction);
      if (!current) throw new Error('Offboarding target is unavailable');
      if (current.offboardingCleanupStatus === 'COMPLETED') return current;
      if (current.lifecycleStatus !== 'OFFBOARDING') throw new Error('Offboarding state is unavailable');
      await transaction.employee.update({
        where: { id: current.id },
        data: {
          offboardingCleanupStatus: 'INCOMPLETE',
          offboardingCleanupAttemptedAt: input.at,
          offboardingCleanupFailureCode: input.failureCode,
          offboardingSessionsRevokedCount: (current.offboardingSessionsRevokedCount ?? 0) + input.sessionsRevoked,
        },
      });
      await this.audit.append({
        organizationId: current.organizationId,
        actionKey: AUDIT_ACTION_KEYS.employeeOffboardingCleanup,
        actorEmployeeId: input.actor.employeeId,
        actorSnapshot: await this.actorSnapshot(transaction, input.actor.organizationId, input.actor.employeeId),
        targetType: 'employee',
        targetId: current.id,
        targetSnapshot: this.targetSnapshot(current),
        safeReason: input.failureCode,
        changeDelta: { changedFields: ['offboardingCleanupAttemptedAt', 'offboardingCleanupFailureCode', 'offboardingCleanupStatus', 'offboardingSessionsRevokedCount'] },
        ...(current.offboardingApprovalReference ? { approvalReference: current.offboardingApprovalReference } : {}),
        ...this.history(input.correlationId),
        occurredAt: input.at,
      }, transaction);
      await this.security.append({
        organizationId: current.organizationId,
        eventType: SECURITY_EVENT_TYPES.employeeOffboardingStarted,
        category: 'employee_offboarding_cleanup_incomplete',
        risk: 'HIGH',
        outcome: 'failed',
        actorEmployeeId: input.actor.employeeId,
        actorAccountId: input.actor.userAccountId,
        actorSnapshot: await this.actorSnapshot(
          transaction,
          input.actor.organizationId,
          input.actor.employeeId,
        ),
        sessionReference: input.actor.sessionId,
        safeContext: {
          targetEmployeeId: current.id,
          cleanupStatus: 'INCOMPLETE',
          failureCategory: input.failureCode,
          sessionsRevoked: (current.offboardingSessionsRevokedCount ?? 0) + input.sessionsRevoked,
        },
        ...this.history(input.correlationId),
        occurredAt: input.at,
      }, transaction);
      return this.requireEmployee(transaction, current.organizationId, current.id);
    });
  }

  async recordSuspensionSessionCleanupFailure(
    input: Parameters<OffboardingRepositoryPort['recordSuspensionSessionCleanupFailure']>[0],
  ): Promise<void> {
    await this.transaction(async (transaction) => {
      const current = await this.lockEmployee(input.organizationId, input.employeeId, transaction);
      if (!current || current.lifecycleStatus !== 'SUSPENDED') return;
      const actor = await this.actorSnapshot(
        transaction,
        input.actor.organizationId,
        input.actor.employeeId,
      );
      await this.audit.append({
        organizationId: current.organizationId,
        actionKey: AUDIT_ACTION_KEYS.employeeSuspended,
        actorEmployeeId: input.actor.employeeId,
        actorSnapshot: actor,
        targetType: 'employee',
        targetId: current.id,
        targetSnapshot: this.targetSnapshot(current),
        safeReason: 'SESSION_CLEANUP_FAILED',
        sessionReference: input.actor.sessionId,
        ...this.history(input.correlationId),
        occurredAt: input.at,
      }, transaction);
      await this.security.append({
        organizationId: current.organizationId,
        eventType: SECURITY_EVENT_TYPES.employeeSuspended,
        category: 'employee_suspension_session_cleanup_incomplete',
        risk: 'HIGH',
        outcome: 'failed',
        actorEmployeeId: input.actor.employeeId,
        actorAccountId: input.actor.userAccountId,
        actorSnapshot: actor,
        sessionReference: input.actor.sessionId,
        safeContext: { targetEmployeeId: current.id, lifecycleStatus: 'SUSPENDED' },
        ...this.history(input.correlationId),
        occurredAt: input.at,
      }, transaction);
    });
  }

  async archive(
    input: Parameters<OffboardingRepositoryPort['archive']>[0],
    transaction: DatabaseTransaction,
  ): Promise<{ readonly changed: boolean; readonly employee: EmployeeDetailView }> {
    if (input.target.lifecycleStatus === 'ARCHIVED') {
      await this.disableAccount(transaction, input.target, input.at);
      return { changed: false, employee: await this.requireEmployee(transaction, input.target.organizationId, input.target.id) };
    }
    if (
      input.target.lifecycleStatus !== 'OFFBOARDING' ||
      input.target.offboardingCleanupStatus !== 'COMPLETED' ||
      input.target.offboardingCleanupCompletedAt === null ||
      input.target.userAccount.authenticationEligible ||
      input.target.userAccount.disabledAt === null
    ) throw new Error('Archive gate is not satisfied');
    await transaction.employee.update({
      where: { id: input.target.id },
      data: { lifecycleStatus: 'ARCHIVED', archivedAt: input.at, lifecycleVersion: { increment: 1 } },
    });
    await this.recordTransition(
      transaction,
      { ...input, reason: 'offboarding_cleanup_completed', approvalReference: input.target.offboardingApprovalReference },
      AUDIT_ACTION_KEYS.employeeArchived,
      SECURITY_EVENT_TYPES.employeeArchived,
      OFFBOARDING_EVENTS.employeeArchived,
      'OFFBOARDING',
      'ARCHIVED',
      ['archivedAt', 'lifecycleStatus', 'lifecycleVersion'],
    );
    return { changed: true, employee: await this.requireEmployee(transaction, input.target.organizationId, input.target.id) };
  }

  private async disableAccount(transaction: DatabaseTransaction, target: LockedLifecycleEmployee, at: Date): Promise<void> {
    await transaction.userAccount.update({
      where: { id: target.userAccount.id },
      data: { authenticationEligible: false, disabledAt: target.userAccount.disabledAt ?? at },
    });
  }

  private async requireEmployee(transaction: DatabaseTransaction, organizationId: string, employeeId: string): Promise<EmployeeDetailView> {
    const employee = await transaction.employee.findFirstOrThrow({ where: { organizationId, id: employeeId }, select: employeeSelect });
    return employeeView(employee);
  }

  private actorSnapshot(transaction: DatabaseTransaction, organizationId: string, employeeId: string) {
    return transaction.employee.findFirstOrThrow({
      where: { organizationId, id: employeeId },
      select: { displayName: true, employeeCode: true },
    }).then((employee) => ({ type: 'employee' as const, ...employee }));
  }

  private targetSnapshot(target: Pick<LockedLifecycleEmployee, 'displayName' | 'employeeCode'>) {
    return { displayName: target.displayName, employeeCode: target.employeeCode };
  }

  private async recordTransition(
    transaction: DatabaseTransaction,
    input: {
      readonly actor: Parameters<OffboardingRepositoryPort['suspendBarrier']>[0]['actor'];
      readonly target: LockedLifecycleEmployee;
      readonly reason: string;
      readonly approvalReference: string | null;
      readonly correlationId: string;
      readonly at: Date;
    },
    actionKey: Parameters<AuditEventAppendPort['append']>[0]['actionKey'],
    securityType: Parameters<SecurityEventAppendPort['append']>[0]['eventType'],
    contract: { readonly eventType: string; readonly eventVersion: number },
    oldLifecycle: string,
    newLifecycle: string,
    changedFields: readonly string[],
  ): Promise<void> {
    const actor = await this.actorSnapshot(transaction, input.actor.organizationId, input.actor.employeeId);
    const history = this.history(input.correlationId);
    await this.audit.append({
      organizationId: input.actor.organizationId,
      actionKey,
      actorEmployeeId: input.actor.employeeId,
      actorSnapshot: actor,
      targetType: 'employee',
      targetId: input.target.id,
      targetSnapshot: this.targetSnapshot(input.target),
      safeReason: input.reason,
      changeDelta: { changedFields },
      ...(input.approvalReference ? { approvalReference: input.approvalReference } : {}),
      sessionReference: input.actor.sessionId,
      ...history,
      occurredAt: input.at,
    }, transaction);
    await this.security.append({
      organizationId: input.actor.organizationId,
      eventType: securityType,
      category: newLifecycle === 'SUSPENDED' ? 'employee_suspended' : newLifecycle === 'OFFBOARDING' ? 'employee_offboarding_started' : 'employee_archived',
      risk: 'HIGH',
      outcome: 'succeeded',
      actorEmployeeId: input.actor.employeeId,
      actorAccountId: input.actor.userAccountId,
      actorSnapshot: actor,
      sessionReference: input.actor.sessionId,
      safeContext: { targetEmployeeId: input.target.id, oldLifecycle, newLifecycle },
      ...history,
      occurredAt: input.at,
    }, transaction);
    await this.outbox(transaction, contract, input.actor.organizationId, {
      organizationId: input.actor.organizationId,
      actorEmployeeId: input.actor.employeeId,
      employeeId: input.target.id,
      oldLifecycle,
      newLifecycle,
      ...(input.approvalReference ? { approvalReference: input.approvalReference } : {}),
      occurredAt: input.at.toISOString(),
    }, input.correlationId, input.at);
  }

  private history(correlationId: string): { readonly requestId?: string; readonly correlationId: string } {
    const current = this.context.get();
    return {
      ...(current?.requestId ? { requestId: current.requestId } : {}),
      correlationId: current?.correlationId ?? correlationId,
    };
  }

  private outbox(
    transaction: DatabaseTransaction,
    contract: { readonly eventType: string; readonly eventVersion: number },
    organizationId: string,
    payload: unknown,
    correlationId: string,
    occurredAt: Date,
  ) {
    const history = this.history(correlationId);
    return persistOutboxEvent(transaction, {
      eventType: contract.eventType,
      eventVersion: contract.eventVersion,
      organizationId,
      correlationId: history.correlationId,
      ...(history.requestId ? { causationId: history.requestId } : {}),
      occurredAt,
      payload,
    });
  }
}
