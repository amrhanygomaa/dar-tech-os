export const ROLE_EVENT_CONTRACTS = {
  roleCreated: {
    name: 'RoleCreated.v1',
    eventType: 'identity.role-created',
    eventVersion: 1,
  },
  roleUpdated: {
    name: 'RoleUpdated.v1',
    eventType: 'identity.role-updated',
    eventVersion: 1,
  },
  roleArchived: {
    name: 'RoleArchived.v1',
    eventType: 'identity.role-archived',
    eventVersion: 1,
  },
  employeeRoleAssigned: {
    name: 'EmployeeRoleAssigned.v1',
    eventType: 'identity.employee-role-assigned',
    eventVersion: 1,
  },
  employeeRoleRemoved: {
    name: 'EmployeeRoleRemoved.v1',
    eventType: 'identity.employee-role-removed',
    eventVersion: 1,
  },
} as const;

export interface RoleEventV1Payload {
  readonly organizationId: string;
  readonly roleId: string;
  readonly occurredAt: string;
}

export interface EmployeeRoleEventV1Payload extends RoleEventV1Payload {
  readonly employeeId: string;
  readonly employeeRoleId: string;
  readonly effectiveAt: string;
  readonly expiresAt: string | null;
}
