import type { DatabaseTransaction } from '@dar-tech/database';
import type { AuthorizationActor } from '../authorization/authorization.contracts.js';
import type { EmployeeDetailView, EmployeeLifecycleStatus } from '../identity/identity.contracts.js';

export const OFFBOARDING_REPOSITORY = Symbol('OFFBOARDING_REPOSITORY');
export const OFFBOARDING_CLEANUP_FAILURE_HOOK = Symbol('OFFBOARDING_CLEANUP_FAILURE_HOOK');

export type LifecycleCommandOutcome =
  | 'changed'
  | 'idempotent'
  | 'approval_required'
  | 'cleanup_incomplete'
  | 'cleanup_completed';

export interface LifecycleCommandResult {
  readonly outcome: LifecycleCommandOutcome;
  readonly employee: EmployeeDetailView;
  readonly approvalReference: string | null;
  readonly securityBarrierActive: boolean;
  readonly historyPreserved: true;
}

export interface LockedLifecycleEmployee extends EmployeeDetailView {
  readonly userAccount: NonNullable<EmployeeDetailView['userAccount']>;
}

export interface CleanupCounts {
  readonly sessionsRevoked: number;
  readonly rolesEnded: number;
  readonly temporaryAccessEnded: number;
  readonly emergencyAccessEnded: number;
}

export interface OffboardingRepositoryPort {
  transaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
  findEmployee(organizationId: string, employeeId: string): Promise<EmployeeDetailView | null>;
  lockEmployee(
    organizationId: string,
    employeeId: string,
    transaction: DatabaseTransaction,
  ): Promise<LockedLifecycleEmployee | null>;
  suspendBarrier(input: {
    readonly actor: AuthorizationActor;
    readonly target: LockedLifecycleEmployee;
    readonly reason: string;
    readonly approvalReference: string | null;
    readonly correlationId: string;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<{ readonly changed: boolean; readonly employee: EmployeeDetailView }>;
  startOffboarding(input: {
    readonly actor: AuthorizationActor;
    readonly target: LockedLifecycleEmployee;
    readonly sourceLifecycle: Extract<EmployeeLifecycleStatus, 'ACTIVE' | 'SUSPENDED'>;
    readonly reason: string;
    readonly approvalReference: string;
    readonly correlationId: string;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<EmployeeDetailView>;
  endRoleAssignments(input: {
    readonly actor: AuthorizationActor;
    readonly target: LockedLifecycleEmployee;
    readonly correlationId: string;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<number>;
  completeCleanup(input: {
    readonly actor: AuthorizationActor;
    readonly target: LockedLifecycleEmployee;
    readonly counts: CleanupCounts;
    readonly correlationId: string;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<EmployeeDetailView>;
  markCleanupIncomplete(input: {
    readonly actor: AuthorizationActor;
    readonly organizationId: string;
    readonly employeeId: string;
    readonly sessionsRevoked: number;
    readonly failureCode: 'SESSION_CLEANUP_FAILED' | 'ACCESS_CLEANUP_FAILED';
    readonly correlationId: string;
    readonly at: Date;
  }): Promise<EmployeeDetailView>;
  recordSuspensionSessionCleanupFailure(input: {
    readonly actor: AuthorizationActor;
    readonly organizationId: string;
    readonly employeeId: string;
    readonly correlationId: string;
    readonly at: Date;
  }): Promise<void>;
  archive(input: {
    readonly actor: AuthorizationActor;
    readonly target: LockedLifecycleEmployee;
    readonly correlationId: string;
    readonly at: Date;
  }, transaction: DatabaseTransaction): Promise<{ readonly changed: boolean; readonly employee: EmployeeDetailView }>;
}

export interface OffboardingCleanupFailureHook {
  beforeAccessCleanup?(): void | Promise<void>;
}

export interface OffboardingMetricsPort {
  record(input: {
    readonly operation: 'suspend' | 'offboard' | 'cleanup' | 'archive';
    readonly outcome: 'succeeded' | 'failed' | 'incomplete' | 'approval_required' | 'idempotent';
    readonly category?: 'validation' | 'authorization' | 'transition' | 'session' | 'access';
  }): void;
}
