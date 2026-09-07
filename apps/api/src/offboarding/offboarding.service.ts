import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { REQUEST_CONTEXT_STORE, type RequestContextStore } from '@dar-tech/observability';
import { ApprovalService } from '../approvals/approval.service.js';
import { AuthorizationActorContext } from '../authorization/authorization-context.js';
import {
  AUTHORIZATION_CLOCK,
  type AuthorizationActor,
  type AuthorizationClock,
  type AuthorizationResource,
} from '../authorization/authorization.contracts.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import {
  EMERGENCY_ACCESS_REPOSITORY,
  type EmergencyAccessRepositoryPort,
} from '../emergency-access/emergency-access.contracts.js';
import type { EmployeeDetailView } from '../identity/identity.contracts.js';
import { SessionService } from '../sessions/session.service.js';
import {
  TEMPORARY_ACCESS_REPOSITORY,
  type TemporaryAccessRepositoryPort,
} from '../temporary-access/temporary-access.contracts.js';
import {
  OFFBOARDING_CLEANUP_FAILURE_HOOK,
  OFFBOARDING_REPOSITORY,
  type LifecycleCommandResult,
  type OffboardingCleanupFailureHook,
  type OffboardingRepositoryPort,
} from './offboarding.contracts.js';
import {
  lifecycleAuthenticationRequired,
  lifecycleConflict,
  lifecycleDenied,
  lifecycleNotFound,
  lifecycleStepUpRequired,
} from './offboarding.errors.js';
import {
  lifecycleFingerprint,
  parseArchiveBody,
  parseLifecycleEmployeeId,
  parseLifecycleReasonBody,
} from './offboarding-input.js';
import { OffboardingMetrics } from './offboarding-metrics.js';

@Injectable()
export class OffboardingService {
  constructor(
    @Inject(AuthorizationActorContext) private readonly actors: AuthorizationActorContext,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(AUTHORIZATION_CLOCK) private readonly clock: AuthorizationClock,
    @Inject(OFFBOARDING_REPOSITORY) private readonly repository: OffboardingRepositoryPort,
    @Inject(TEMPORARY_ACCESS_REPOSITORY) private readonly temporaryAccess: TemporaryAccessRepositoryPort,
    @Inject(EMERGENCY_ACCESS_REPOSITORY) private readonly emergencyAccess: EmergencyAccessRepositoryPort,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(OFFBOARDING_CLEANUP_FAILURE_HOOK) private readonly failureHook: OffboardingCleanupFailureHook,
    @Inject(REQUEST_CONTEXT_STORE) private readonly context: RequestContextStore,
    @Inject(OffboardingMetrics) private readonly metrics: OffboardingMetrics,
  ) {}

  async suspend(employeeIdInput: string, body: unknown): Promise<LifecycleCommandResult> {
    try {
      return await this.suspendCommand(employeeIdInput, body);
    } catch (error) {
      this.metrics.record({ operation: 'suspend', outcome: 'failed', category: this.failureCategory(error) });
      throw error;
    }
  }

  private async suspendCommand(employeeIdInput: string, body: unknown): Promise<LifecycleCommandResult> {
    const actor = this.requireActor();
    const employeeId = parseLifecycleEmployeeId(employeeIdInput);
    const parsed = parseLifecycleReasonBody(body);
    const at = this.clock.now();
    await this.requireBaseAuthority(actor, 'admin.employee.suspend', employeeId, at);
    const [target, requester] = await Promise.all([
      this.repository.findEmployee(actor.organizationId, employeeId),
      this.repository.findEmployee(actor.organizationId, actor.employeeId),
    ]);
    if (!target?.userAccount) throw lifecycleNotFound();
    if (!requester) throw lifecycleAuthenticationRequired();
    if (target.lifecycleStatus === 'SUSPENDED') {
      const repaired = await this.repository.transaction(async (transaction) => {
        const locked = await this.repository.lockEmployee(actor.organizationId, employeeId, transaction);
        if (!locked) throw lifecycleNotFound();
        if (locked.lifecycleStatus !== 'SUSPENDED') throw lifecycleConflict();
        return this.repository.suspendBarrier({ actor, target: locked, reason: parsed.reason, approvalReference: parsed.approvalReference, correlationId: this.correlationId(), at }, transaction);
      });
      await this.revokeSuspendedSessions(actor, employeeId, at);
      this.metrics.record({ operation: 'suspend', outcome: 'idempotent' });
      return this.result('idempotent', repaired.employee, parsed.approvalReference, true);
    }
    if (target.lifecycleStatus !== 'ACTIVE') throw lifecycleConflict();
    const mutation = await this.repository.transaction(async (transaction) => {
      const locked = await this.repository.lockEmployee(actor.organizationId, employeeId, transaction);
      if (!locked) throw lifecycleNotFound();
      if (locked.lifecycleStatus === 'SUSPENDED') return { changed: false, employee: locked, approvalReference: parsed.approvalReference };
      if (locked.lifecycleStatus !== 'ACTIVE') throw lifecycleConflict();
      const safeContext = this.commandContext('suspend', locked, parsed.reason);
      const prepared = await this.approvals.prepareApprovalForAction({
        actor,
        action: 'admin.employee.suspend',
        resource: this.resource(actor, employeeId),
        risk: 'HIGH',
        safeContext,
        requesterSnapshot: { displayName: requester.displayName },
        resourceSnapshot: { displayName: locked.displayName },
        safeReason: parsed.reason,
        correlationId: this.correlationId(),
        idempotencyMaterial: lifecycleFingerprint(actor.organizationId, actor.employeeId, employeeId, 'suspend', locked.lifecycleStatus, parsed.reason),
        at,
      }, transaction);
      if (prepared.outcome === 'STEP_UP_REQUIRED') throw lifecycleStepUpRequired();
      if (prepared.outcome === 'APPROVAL_REQUIRED') {
        if (
          parsed.approvalReference === prepared.request.id &&
          ['REJECTED', 'FAILED'].includes(prepared.request.status)
        ) throw lifecycleDenied();
        if (!parsed.approvalReference || parsed.approvalReference !== prepared.request.id || prepared.request.status !== 'APPROVED') {
          if (parsed.approvalReference && parsed.approvalReference !== prepared.request.id) throw lifecycleDenied();
          return { changed: false, employee: locked, approvalReference: prepared.request.id, pending: true as const };
        }
        const claim = await this.approvals.claimApprovedAction({
          actor,
          approvalReference: parsed.approvalReference,
          action: 'admin.employee.suspend',
          resource: this.resource(actor, employeeId),
          risk: 'HIGH',
          safeContext,
          correlationId: this.correlationId(),
          at,
        }, transaction);
        if (claim.status !== 'claimed') throw lifecycleConflict();
        const result = await this.repository.suspendBarrier({ actor, target: locked, reason: parsed.reason, approvalReference: parsed.approvalReference, correlationId: this.correlationId(), at }, transaction);
        await this.approvals.completeApprovedAction({
          claimVersion: claim.claimVersion,
          organizationId: actor.organizationId,
          approvalReference: parsed.approvalReference,
          resultReference: `employee-suspension:${employeeId}`,
          correlationId: this.correlationId(),
          at,
        }, transaction);
        return { ...result, approvalReference: parsed.approvalReference };
      }
      const result = await this.repository.suspendBarrier({ actor, target: locked, reason: parsed.reason, approvalReference: null, correlationId: this.correlationId(), at }, transaction);
      return { ...result, approvalReference: null };
    });
    if ('pending' in mutation) {
      this.metrics.record({ operation: 'suspend', outcome: 'approval_required' });
      return this.result('approval_required', mutation.employee, mutation.approvalReference, false);
    }
    await this.revokeSuspendedSessions(actor, employeeId, at);
    this.metrics.record({ operation: 'suspend', outcome: mutation.changed ? 'succeeded' : 'idempotent' });
    return this.result(mutation.changed ? 'changed' : 'idempotent', mutation.employee, mutation.approvalReference, true);
  }

  async offboard(employeeIdInput: string, body: unknown): Promise<LifecycleCommandResult> {
    try {
      return await this.offboardCommand(employeeIdInput, body);
    } catch (error) {
      this.metrics.record({ operation: 'offboard', outcome: 'failed', category: this.failureCategory(error) });
      throw error;
    }
  }

  private async offboardCommand(employeeIdInput: string, body: unknown): Promise<LifecycleCommandResult> {
    const actor = this.requireActor();
    const employeeId = parseLifecycleEmployeeId(employeeIdInput);
    const parsed = parseLifecycleReasonBody(body);
    const at = this.clock.now();
    await this.requireBaseAuthority(actor, 'admin.employee.offboard', employeeId, at);
    const [target, requester] = await Promise.all([
      this.repository.findEmployee(actor.organizationId, employeeId),
      this.repository.findEmployee(actor.organizationId, actor.employeeId),
    ]);
    if (!target?.userAccount) throw lifecycleNotFound();
    if (!requester) throw lifecycleAuthenticationRequired();
    if (target.lifecycleStatus === 'OFFBOARDING') {
      if (
        target.offboardingReason !== parsed.reason ||
        (parsed.approvalReference && parsed.approvalReference !== target.offboardingApprovalReference)
      ) throw lifecycleConflict();
      return this.cleanup(actor, target, at);
    }
    if (!['ACTIVE', 'SUSPENDED'].includes(target.lifecycleStatus)) throw lifecycleConflict();
    const started = await this.repository.transaction(async (transaction) => {
      const locked = await this.repository.lockEmployee(actor.organizationId, employeeId, transaction);
      if (!locked) throw lifecycleNotFound();
      if (locked.lifecycleStatus === 'OFFBOARDING') {
        if (
          locked.offboardingReason !== parsed.reason ||
          (parsed.approvalReference && parsed.approvalReference !== locked.offboardingApprovalReference)
        ) throw lifecycleConflict();
        return { employee: locked, approvalReference: locked.offboardingApprovalReference, pending: false as const };
      }
      if (!['ACTIVE', 'SUSPENDED'].includes(locked.lifecycleStatus)) throw lifecycleConflict();
      const safeContext = this.commandContext('offboard', locked, parsed.reason);
      const prepared = await this.approvals.prepareApprovalForAction({
        actor,
        action: 'admin.employee.offboard',
        resource: this.resource(actor, employeeId),
        risk: 'HIGH',
        safeContext,
        requesterSnapshot: { displayName: requester.displayName },
        resourceSnapshot: { displayName: locked.displayName },
        safeReason: parsed.reason,
        correlationId: this.correlationId(),
        idempotencyMaterial: lifecycleFingerprint(actor.organizationId, actor.employeeId, employeeId, 'offboard', locked.lifecycleStatus, parsed.reason),
        at,
      }, transaction);
      if (prepared.outcome === 'STEP_UP_REQUIRED') throw lifecycleStepUpRequired();
      if (prepared.outcome !== 'APPROVAL_REQUIRED') throw lifecycleDenied();
      if (
        parsed.approvalReference === prepared.request.id &&
        ['REJECTED', 'FAILED'].includes(prepared.request.status)
      ) throw lifecycleDenied();
      if (!parsed.approvalReference || parsed.approvalReference !== prepared.request.id || prepared.request.status !== 'APPROVED') {
        if (parsed.approvalReference && parsed.approvalReference !== prepared.request.id) throw lifecycleDenied();
        return { employee: locked, approvalReference: prepared.request.id, pending: true as const };
      }
      const claim = await this.approvals.claimApprovedAction({
        actor,
        approvalReference: parsed.approvalReference,
        action: 'admin.employee.offboard',
        resource: this.resource(actor, employeeId),
        risk: 'HIGH',
        safeContext,
        correlationId: this.correlationId(),
        at,
      }, transaction);
      if (claim.status !== 'claimed') throw lifecycleConflict();
      const employee = await this.repository.startOffboarding({
        actor,
        target: locked,
        sourceLifecycle: locked.lifecycleStatus as 'ACTIVE' | 'SUSPENDED',
        reason: parsed.reason,
        approvalReference: parsed.approvalReference,
        correlationId: this.correlationId(),
        at,
      }, transaction);
      await this.approvals.completeApprovedAction({
        claimVersion: claim.claimVersion,
        organizationId: actor.organizationId,
        approvalReference: parsed.approvalReference,
        resultReference: `employee-offboarding:${employeeId}`,
        correlationId: this.correlationId(),
        at,
      }, transaction);
      return { employee, approvalReference: parsed.approvalReference, pending: false as const };
    });
    if (started.pending) {
      this.metrics.record({ operation: 'offboard', outcome: 'approval_required' });
      return this.result('approval_required', started.employee, started.approvalReference, false);
    }
    this.metrics.record({ operation: 'offboard', outcome: 'succeeded' });
    return this.cleanup(actor, started.employee, at);
  }

  async archive(employeeIdInput: string, body: unknown): Promise<LifecycleCommandResult> {
    try {
      return await this.archiveCommand(employeeIdInput, body);
    } catch (error) {
      this.metrics.record({ operation: 'archive', outcome: 'failed', category: this.failureCategory(error) });
      throw error;
    }
  }

  private async archiveCommand(employeeIdInput: string, body: unknown): Promise<LifecycleCommandResult> {
    const actor = this.requireActor();
    const employeeId = parseLifecycleEmployeeId(employeeIdInput);
    parseArchiveBody(body);
    const at = this.clock.now();
    await this.requireBaseAuthority(actor, 'admin.employee.offboard', employeeId, at);
    const target = await this.repository.findEmployee(actor.organizationId, employeeId);
    if (!target?.userAccount) throw lifecycleNotFound();
    if (target.lifecycleStatus === 'ARCHIVED') {
      const result = await this.repository.transaction(async (transaction) => {
        const locked = await this.repository.lockEmployee(actor.organizationId, employeeId, transaction);
        if (!locked) throw lifecycleNotFound();
        return this.repository.archive({ actor, target: locked, correlationId: this.correlationId(), at }, transaction);
      });
      this.metrics.record({ operation: 'archive', outcome: 'idempotent' });
      return this.result('idempotent', result.employee, result.employee.offboardingApprovalReference, true);
    }
    if (target.lifecycleStatus !== 'OFFBOARDING' || target.offboardingCleanupStatus !== 'COMPLETED') throw lifecycleConflict();
    const result = await this.repository.transaction(async (transaction) => {
      const locked = await this.repository.lockEmployee(actor.organizationId, employeeId, transaction);
      if (!locked) throw lifecycleNotFound();
      try {
        return await this.repository.archive({ actor, target: locked, correlationId: this.correlationId(), at }, transaction);
      } catch {
        throw lifecycleConflict();
      }
    });
    this.metrics.record({ operation: 'archive', outcome: result.changed ? 'succeeded' : 'idempotent' });
    return this.result(result.changed ? 'changed' : 'idempotent', result.employee, result.employee.offboardingApprovalReference, true);
  }

  private async cleanup(actor: AuthorizationActor, employee: EmployeeDetailView, at: Date): Promise<LifecycleCommandResult> {
    if (employee.offboardingCleanupStatus === 'COMPLETED') {
      this.metrics.record({ operation: 'cleanup', outcome: 'idempotent' });
      return this.result('idempotent', employee, employee.offboardingApprovalReference, true);
    }
    let sessionsRevoked = 0;
    try {
      const sessionResult = await this.sessions.revokeAllForEmployee({
        organizationId: actor.organizationId,
        employeeId: employee.id,
        actorEmployeeId: actor.employeeId,
        actorAccountId: actor.userAccountId,
        currentSessionId: actor.sessionId,
        now: at,
      });
      if (!sessionResult) throw new Error('session target unavailable');
      sessionsRevoked = sessionResult.revokedCount;
    } catch {
      return this.incomplete(actor, employee, sessionsRevoked, 'SESSION_CLEANUP_FAILED', at);
    }
    try {
      await this.failureHook.beforeAccessCleanup?.();
      const completed = await this.repository.transaction(async (transaction) => {
        const locked = await this.repository.lockEmployee(actor.organizationId, employee.id, transaction);
        if (!locked) throw new Error('target unavailable');
        if (locked.offboardingCleanupStatus === 'COMPLETED') return locked;
        if (locked.lifecycleStatus !== 'OFFBOARDING') throw new Error('target lifecycle changed');
        const rolesEnded = await this.repository.endRoleAssignments({ actor, target: locked, correlationId: this.correlationId(), at }, transaction);
        const temporaryAccessEnded = await this.temporaryAccess.revokeAllForRecipient({ organizationId: actor.organizationId, recipientEmployeeId: employee.id, actorEmployeeId: actor.employeeId, correlationId: this.correlationId(), at }, transaction);
        const emergencyAccessEnded = await this.emergencyAccess.revokeAllForRecipient({ organizationId: actor.organizationId, recipientEmployeeId: employee.id, actorEmployeeId: actor.employeeId, correlationId: this.correlationId(), at }, transaction);
        return this.repository.completeCleanup({
          actor,
          target: locked,
          counts: { sessionsRevoked, rolesEnded, temporaryAccessEnded, emergencyAccessEnded },
          correlationId: this.correlationId(),
          at,
        }, transaction);
      });
      this.metrics.record({ operation: 'cleanup', outcome: completed.offboardingCleanupStatus === 'COMPLETED' ? 'succeeded' : 'idempotent' });
      return this.result('cleanup_completed', completed, completed.offboardingApprovalReference, true);
    } catch {
      return this.incomplete(actor, employee, sessionsRevoked, 'ACCESS_CLEANUP_FAILED', at);
    }
  }

  private async incomplete(
    actor: AuthorizationActor,
    employee: EmployeeDetailView,
    sessionsRevoked: number,
    failureCode: 'SESSION_CLEANUP_FAILED' | 'ACCESS_CLEANUP_FAILED',
    at: Date,
  ): Promise<LifecycleCommandResult> {
    const category = failureCode === 'SESSION_CLEANUP_FAILED' ? 'session' : 'access';
    let incomplete: EmployeeDetailView;
    try {
      incomplete = await this.repository.markCleanupIncomplete({
        actor,
        organizationId: actor.organizationId,
        employeeId: employee.id,
        sessionsRevoked,
        failureCode,
        correlationId: this.correlationId(),
        at,
      });
    } catch (error) {
      this.metrics.record({ operation: 'cleanup', outcome: 'incomplete', category });
      throw error;
    }
    this.metrics.record({ operation: 'cleanup', outcome: 'incomplete', category });
    return this.result('cleanup_incomplete', incomplete, incomplete.offboardingApprovalReference, true);
  }

  private async revokeSuspendedSessions(actor: AuthorizationActor, employeeId: string, at: Date): Promise<void> {
    try {
      const result = await this.sessions.revokeAllForEmployee({
        organizationId: actor.organizationId,
        employeeId,
        actorEmployeeId: actor.employeeId,
        actorAccountId: actor.userAccountId,
        currentSessionId: actor.sessionId,
        now: at,
      });
      if (!result) throw new Error('session target unavailable');
    } catch {
      this.metrics.record({ operation: 'suspend', outcome: 'failed', category: 'session' });
      try {
        await this.repository.recordSuspensionSessionCleanupFailure({
          actor,
          organizationId: actor.organizationId,
          employeeId,
          correlationId: this.correlationId(),
          at,
        });
      } catch {
        // The committed lifecycle/account barrier remains authoritative even if failure evidence is unavailable.
      }
      throw lifecycleConflict();
    }
  }

  private requireActor(): AuthorizationActor {
    const actor = this.actors.currentActor();
    if (!actor) throw lifecycleAuthenticationRequired();
    return actor;
  }

  private async requireBaseAuthority(actor: AuthorizationActor, action: 'admin.employee.suspend' | 'admin.employee.offboard', employeeId: string, at: Date): Promise<void> {
    const decision = await this.authorization.authorize(actor, action, this.resource(actor, employeeId), { at, source: 'http' });
    if (!decision.allowed && !['APPROVAL_REQUIRED', 'STEP_UP_REQUIRED'].includes(decision.reasonCode)) {
      this.metrics.record({ operation: action.endsWith('suspend') ? 'suspend' : 'offboard', outcome: 'failed', category: 'authorization' });
      throw lifecycleDenied();
    }
  }

  private commandContext(command: 'suspend' | 'offboard', target: EmployeeDetailView, reason: string) {
    return {
      command,
      targetEmployeeId: target.id,
      targetLifecycle: target.lifecycleStatus,
      targetAccountState: target.userAccount?.authenticationEligible && !target.userAccount.disabledAt ? 'ELIGIBLE' : 'INELIGIBLE',
      reasonFingerprint: lifecycleFingerprint(reason),
      accessImpact: command === 'offboard' ? 'DISABLE_AND_REVOKE_ALL_TARGET_ACCESS' : 'DISABLE_AND_REVOKE_SESSIONS',
    } as const;
  }

  private resource(actor: AuthorizationActor, employeeId: string): AuthorizationResource {
    return { type: 'employee', organizationId: actor.organizationId, id: employeeId };
  }

  private correlationId(): string {
    return this.context.get()?.correlationId ?? randomUUID();
  }

  private failureCategory(error: unknown): 'validation' | 'authorization' | 'transition' {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { readonly statusCode?: unknown }).statusCode
      : undefined;
    if (statusCode === 400 || statusCode === 422) return 'validation';
    if (statusCode === 401 || statusCode === 403 || statusCode === 404) return 'authorization';
    return 'transition';
  }

  private result(outcome: LifecycleCommandResult['outcome'], employee: EmployeeDetailView, approvalReference: string | null, barrier: boolean): LifecycleCommandResult {
    return { outcome, employee, approvalReference, securityBarrierActive: barrier, historyPreserved: true };
  }
}
