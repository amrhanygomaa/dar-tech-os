import type { EventRisk } from "../event-history/event-history.contracts.js";
import type { PermissionDefinition } from "./permission-manifest.js";

export const PERMISSION_ACTIONS = {
  read: "admin.permission.read",
  manage: "admin.permission.manage",
} as const;

export type PermissionAction =
  (typeof PERMISSION_ACTIONS)[keyof typeof PERMISSION_ACTIONS];

export const SCOPE_TYPES = [
  "SELF",
  "ASSIGNED",
  "TEAM",
  "DEPARTMENT",
  "PROJECT",
  "CUSTOMER",
  "ORGANIZATION",
  "EXPLICIT",
] as const;

export type ScopeType = (typeof SCOPE_TYPES)[number];

export interface PermissionActor {
  readonly actorType: "employee";
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
}

export interface PermissionActorPort {
  currentActor(): Promise<PermissionActor | null>;
}

export interface PermissionAdministrationAuthorizationPort {
  allows(request: {
    readonly actor: PermissionActor;
    readonly action: PermissionAction;
    readonly resource: {
      readonly type: "permission-catalog" | "role-permission";
      readonly organizationId: string;
      readonly roleId?: string;
      readonly permissionKey?: string;
    };
  }): Promise<boolean>;
}

export interface PermissionClock {
  now(): Date;
}

export interface PermissionView {
  readonly id: string;
  readonly key: string;
  readonly domain: string;
  readonly resource: string;
  readonly action: string;
  readonly description: string;
  readonly riskClassification: EventRisk;
  readonly active: boolean;
  readonly deprecatedAt: Date | null;
  readonly replacementPermissionKey: string | null;
  readonly definitionVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PermissionPage {
  readonly items: readonly PermissionView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface RolePermissionView {
  readonly id: string;
  readonly organizationId: string;
  readonly roleId: string;
  readonly permissionId: string;
  readonly permission: PermissionView;
  readonly scopeType: ScopeType;
  readonly scopeBindingType: string | null;
  readonly scopeBindingId: string | null;
  readonly grantedByEmployeeId: string;
  readonly grantedAt: Date;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
  readonly removedAt: Date | null;
  readonly removedByEmployeeId: string | null;
  readonly effective: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RolePermissionPage {
  readonly items: readonly RolePermissionView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface GrantRolePermissionInput {
  readonly permissionKey: string;
  readonly scopeType: ScopeType;
  readonly scopeBindingType: string | null;
  readonly scopeBindingId: string | null;
  readonly expiresAt: Date | null;
}

export type RolePermissionGrantResult =
  | { readonly status: "granted"; readonly grant: RolePermissionView }
  | { readonly status: "idempotent"; readonly grant: RolePermissionView }
  | { readonly status: "conflict" }
  | { readonly status: "archived" }
  | { readonly status: "permission_unavailable" }
  | { readonly status: "not_found" };

export type RolePermissionRemovalResult =
  | { readonly status: "removed"; readonly grant: RolePermissionView }
  | { readonly status: "idempotent"; readonly grant: RolePermissionView }
  | { readonly status: "not_found" };

export interface EffectivePermissionGrant {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly roleId: string;
  readonly rolePermissionId: string;
  readonly permissionKey: string;
  readonly riskClassification: EventRisk;
  readonly scopeType: ScopeType;
  readonly scopeBindingType: string | null;
  readonly scopeBindingId: string | null;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
}

export type PermissionRegistryIssueCode =
  | "REQUIRED_KEY_MISSING"
  | "MALFORMED_KEY"
  | "DUPLICATE_KEY"
  | "METADATA_MISMATCH"
  | "ACTIVE_UNKNOWN_PERMISSION"
  | "INVALID_GRANT_REFERENCE"
  | "INCOMPATIBLE_DEFINITION_VERSION";

export interface PermissionRegistryIssue {
  readonly code: PermissionRegistryIssueCode;
  readonly permissionKey: string;
  readonly rolePermissionId?: string;
}

export interface PermissionRegistryValidationResult {
  readonly valid: boolean;
  readonly canonicalCount: number;
  readonly persistedCount: number;
  readonly issues: readonly PermissionRegistryIssue[];
}

export interface PermissionRegistrySyncResult {
  readonly registered: number;
  readonly metadataUpdated: number;
  readonly unchanged: number;
}

export interface PermissionRepositoryPort {
  list(page: number, pageSize: number): Promise<PermissionPage>;
  listRolePermissions(
    organizationId: string,
    roleId: string,
    page: number,
    pageSize: number,
    at: Date,
  ): Promise<RolePermissionPage | null>;
  grant(input: {
    readonly actor: PermissionActor;
    readonly roleId: string;
    readonly definition: PermissionDefinition;
    readonly grant: GrantRolePermissionInput;
    readonly effectiveAt: Date;
  }): Promise<RolePermissionGrantResult>;
  remove(input: {
    readonly actor: PermissionActor;
    readonly roleId: string;
    readonly definition: PermissionDefinition;
    readonly removedAt: Date;
  }): Promise<RolePermissionRemovalResult>;
  listEffectivePermissionGrantsForEmployee(
    organizationId: string,
    employeeId: string,
    at: Date,
  ): Promise<readonly EffectivePermissionGrant[]>;
  synchronizeRegistry(
    definitions: readonly PermissionDefinition[],
    occurredAt: Date,
  ): Promise<PermissionRegistrySyncResult>;
  validateRegistry(
    definitions: readonly PermissionDefinition[],
  ): Promise<PermissionRegistryValidationResult>;
}

export interface PermissionMetricsPort {
  record(input: {
    readonly operation:
      "catalog" | "history" | "grant" | "remove" | "sync" | "validate";
    readonly outcome:
      | "succeeded"
      | "failed"
      | "denied"
      | "idempotent"
      | "conflict"
      | "not_found"
      | "drift";
    readonly denialCategory?: "missing_actor" | "authorization_denied";
    readonly risk?: EventRisk;
    readonly scopeType?: ScopeType;
  }): void;
}

export const PERMISSION_ACTOR_PORT = Symbol("PERMISSION_ACTOR_PORT");
export const PERMISSION_ADMINISTRATION_AUTHORIZATION_PORT = Symbol(
  "PERMISSION_ADMINISTRATION_AUTHORIZATION_PORT",
);
export const PERMISSION_CLOCK = Symbol("PERMISSION_CLOCK");
export const PERMISSION_REPOSITORY_PORT = Symbol("PERMISSION_REPOSITORY_PORT");
export const PERMISSION_METRICS_PORT = Symbol("PERMISSION_METRICS_PORT");
