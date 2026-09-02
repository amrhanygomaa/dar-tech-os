export const ROLE_ACTIONS = {
  read: 'admin.role.read',
  create: 'admin.role.create',
  update: 'admin.role.update',
  archive: 'admin.role.archive',
  assign: 'admin.role.assign',
} as const;

export type RoleAction = (typeof ROLE_ACTIONS)[keyof typeof ROLE_ACTIONS];

export interface RoleActor {
  readonly actorType: 'employee';
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
}

export interface RoleActorPort {
  currentActor(): Promise<RoleActor | null>;
}

export interface RoleAuthorizationPort {
  authorize(request: {
    readonly actor: RoleActor;
    readonly action: RoleAction;
    readonly resource: {
      readonly type: 'role' | 'employee-role';
      readonly organizationId: string;
      readonly id?: string;
    };
  }): Promise<boolean>;
}

export interface RoleClock {
  now(): Date;
}

export interface RoleView {
  readonly id: string;
  readonly organizationId: string;
  readonly key: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string | null;
  readonly archived: boolean;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RolePage {
  readonly items: readonly RoleView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface EmployeeRoleView {
  readonly id: string;
  readonly organizationId: string;
  readonly employeeId: string;
  readonly roleId: string;
  readonly role: RoleView;
  readonly assignedByEmployeeId: string;
  readonly assignedAt: Date;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
  readonly removedAt: Date | null;
  readonly removedByEmployeeId: string | null;
  readonly safeRemovalReason: string | null;
  readonly effective: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateRoleInput {
  readonly key: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string | null;
}

export interface UpdateRoleInput {
  readonly name?: string;
  readonly normalizedName?: string;
  readonly description?: string | null;
}

export type RoleMutationResult =
  | { readonly status: 'changed'; readonly role: RoleView }
  | { readonly status: 'idempotent'; readonly role: RoleView }
  | { readonly status: 'not_found' };

export type EmployeeRoleAssignmentResult =
  | { readonly status: 'assigned'; readonly assignment: EmployeeRoleView }
  | { readonly status: 'idempotent'; readonly assignment: EmployeeRoleView }
  | { readonly status: 'conflict' }
  | { readonly status: 'archived' }
  | { readonly status: 'not_found' };

export type EmployeeRoleRemovalResult =
  | { readonly status: 'removed'; readonly assignment: EmployeeRoleView }
  | { readonly status: 'idempotent'; readonly assignment: EmployeeRoleView }
  | { readonly status: 'not_found' };

export interface RoleRepositoryPort {
  list(organizationId: string, page: number, pageSize: number): Promise<RolePage>;
  create(input: {
    readonly actor: RoleActor;
    readonly role: CreateRoleInput;
    readonly occurredAt: Date;
  }): Promise<RoleView>;
  update(input: {
    readonly actor: RoleActor;
    readonly roleId: string;
    readonly patch: UpdateRoleInput;
    readonly occurredAt: Date;
  }): Promise<RoleMutationResult>;
  archive(input: {
    readonly actor: RoleActor;
    readonly roleId: string;
    readonly occurredAt: Date;
  }): Promise<RoleMutationResult>;
  assign(input: {
    readonly actor: RoleActor;
    readonly employeeId: string;
    readonly roleId: string;
    readonly effectiveAt: Date;
    readonly expiresAt: Date | null;
  }): Promise<EmployeeRoleAssignmentResult>;
  remove(input: {
    readonly actor: RoleActor;
    readonly employeeId: string;
    readonly roleId: string;
    readonly removedAt: Date;
  }): Promise<EmployeeRoleRemovalResult>;
  listEffectiveRolesForEmployee(
    organizationId: string,
    employeeId: string,
    at: Date,
  ): Promise<readonly EmployeeRoleView[]>;
}

export interface RoleMetricsPort {
  record(input: {
    readonly operation: 'list' | 'create' | 'update' | 'archive' | 'assign' | 'remove';
    readonly outcome:
      | 'succeeded'
      | 'failed'
      | 'denied'
      | 'idempotent'
      | 'conflict'
      | 'not_found';
    readonly denialCategory?: 'missing_actor' | 'authorization_denied';
  }): void;
}

export const ROLE_ACTOR_PORT = Symbol('ROLE_ACTOR_PORT');
export const ROLE_AUTHORIZATION_PORT = Symbol('ROLE_AUTHORIZATION_PORT');
export const ROLE_CLOCK = Symbol('ROLE_CLOCK');
export const ROLE_REPOSITORY_PORT = Symbol('ROLE_REPOSITORY_PORT');
export const ROLE_METRICS_PORT = Symbol('ROLE_METRICS_PORT');
