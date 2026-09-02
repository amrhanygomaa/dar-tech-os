export const EMPLOYEE_LIFECYCLE_STATUSES = [
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'OFFBOARDING',
  'ARCHIVED',
] as const;

export type EmployeeLifecycleStatus = (typeof EMPLOYEE_LIFECYCLE_STATUSES)[number];

export const IDENTITY_ACTIONS = {
  readSelf: 'identity.account.read_self',
  updateSelf: 'identity.account.update_self',
  readEmployee: 'admin.employee.read',
  updateEmployee: 'admin.employee.update',
} as const;

export type IdentityAction = (typeof IDENTITY_ACTIONS)[keyof typeof IDENTITY_ACTIONS];

export interface TrustedActor {
  readonly actorType: 'employee';
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
}

export interface AuthenticatedActorPort {
  currentActor(): Promise<TrustedActor | null>;
}

export interface IdentityAuthorizationRequest {
  readonly actor: TrustedActor;
  readonly action: IdentityAction;
  readonly resource: {
    readonly type: 'employee' | 'user-account';
    readonly organizationId: string;
    readonly id?: string;
  };
}

export interface IdentityAuthorizationPort {
  authorize(request: IdentityAuthorizationRequest): Promise<boolean>;
}

export interface IdentityAuditEntry {
  readonly action: typeof IDENTITY_ACTIONS.updateSelf | typeof IDENTITY_ACTIONS.updateEmployee;
  readonly actor: TrustedActor;
  readonly targetType: 'employee';
  readonly targetId: string;
  readonly organizationId: string;
  readonly changedFields: readonly string[];
  readonly actorSnapshot: {
    readonly displayName: string;
    readonly employeeCode: string;
  };
  readonly targetSnapshot: {
    readonly displayName: string;
    readonly employeeCode: string;
  };
}

export interface IdentityAuditHook {
  record(entry: IdentityAuditEntry, transaction: DatabaseTransaction): Promise<void>;
}

export interface IdentityTransactionPort {
  run<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
}

export interface EmployeeProfilePatch {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly displayName?: string;
  readonly workEmail?: string;
}

export interface EmployeeView {
  readonly id: string;
  readonly organizationId: string;
  readonly employeeCode: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string;
  readonly workEmail: string;
  readonly lifecycleStatus: EmployeeLifecycleStatus;
  readonly invitedAt: Date;
  readonly activatedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly offboardingAt: Date | null;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserAccountView {
  readonly id: string;
  readonly organizationId: string;
  readonly employeeId: string;
  readonly authenticationEligible: boolean;
  readonly activatedAt: Date | null;
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EmployeeDetailView extends EmployeeView {
  readonly userAccount: UserAccountView | null;
}

export interface SelfIdentityView {
  readonly organization: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly employee: EmployeeView;
  readonly userAccount: UserAccountView;
}

export interface EmployeePage {
  readonly items: readonly EmployeeDetailView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface SSOIdentityView {
  readonly id: string;
  readonly organizationId: string;
  readonly userAccountId: string;
  readonly providerKey: string;
  readonly providerSubject: string;
  readonly verifiedEmailNormalized: string | null;
  readonly linkedAt: Date;
  readonly lastAuthenticatedAt: Date | null;
}

export interface IdentityRepositoryPort {
  findSelf(
    organizationId: string,
    employeeId: string,
    userAccountId: string,
  ): Promise<SelfIdentityView | null>;
  listEmployees(organizationId: string, page: number, pageSize: number): Promise<EmployeePage>;
  findEmployeeById(
    organizationId: string,
    employeeId: string,
    transaction?: DatabaseTransaction,
  ): Promise<EmployeeDetailView | null>;
  updateEmployeeProfile(
    organizationId: string,
    employeeId: string,
    patch: EmployeeProfilePatch,
    transaction?: DatabaseTransaction,
  ): Promise<EmployeeDetailView | null>;
  findAccountById(organizationId: string, userAccountId: string): Promise<UserAccountView | null>;
  findSSOIdentity(
    organizationId: string,
    providerKey: string,
    providerSubject: string,
  ): Promise<SSOIdentityView | null>;
}

export const AUTHENTICATED_ACTOR_PORT = Symbol('AUTHENTICATED_ACTOR_PORT');
export const IDENTITY_AUTHORIZATION_PORT = Symbol('IDENTITY_AUTHORIZATION_PORT');
export const IDENTITY_AUDIT_HOOK = Symbol('IDENTITY_AUDIT_HOOK');
export const IDENTITY_REPOSITORY_PORT = Symbol('IDENTITY_REPOSITORY_PORT');
export const IDENTITY_TRANSACTION_PORT = Symbol('IDENTITY_TRANSACTION_PORT');
import type { DatabaseTransaction } from '@dar-tech/database';
