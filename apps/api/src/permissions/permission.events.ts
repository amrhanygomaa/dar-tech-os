export const PERMISSION_EVENT_CONTRACTS = {
  permissionRegistered: {
    name: "PermissionRegistered.v1",
    eventType: "identity.permission-registered",
    eventVersion: 1,
  },
  rolePermissionGranted: {
    name: "RolePermissionGranted.v1",
    eventType: "identity.role-permission-granted",
    eventVersion: 1,
  },
  rolePermissionRemoved: {
    name: "RolePermissionRemoved.v1",
    eventType: "identity.role-permission-removed",
    eventVersion: 1,
  },
} as const;

export interface PermissionRegisteredV1Payload {
  readonly permissionKey: string;
  readonly domain: string;
  readonly resource: string;
  readonly action: string;
  readonly riskClassification: string;
  readonly definitionVersion: number;
  readonly occurredAt: string;
}

export interface RolePermissionGrantedV1Payload {
  readonly organizationId: string;
  readonly roleId: string;
  readonly rolePermissionId: string;
  readonly permissionKey: string;
  readonly scopeType: string;
  readonly scopeBindingType: string | null;
  readonly scopeBindingId: string | null;
  readonly effectiveAt: string;
  readonly expiresAt: string | null;
  readonly occurredAt: string;
}

export interface RolePermissionRemovedV1Payload {
  readonly organizationId: string;
  readonly roleId: string;
  readonly rolePermissionId: string;
  readonly permissionKey: string;
  readonly occurredAt: string;
}
