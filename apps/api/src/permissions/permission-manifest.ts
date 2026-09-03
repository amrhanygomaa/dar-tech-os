import type { EventRisk } from "../event-history/event-history.contracts.js";

const permissionSegmentPattern = /^[a-z][a-z0-9_]*$/u;
export const PERMISSION_KEY_MAX_LENGTH = 160;
export const PERMISSION_DEFINITION_VERSION = 1;

export interface PermissionDefinition {
  readonly key: string;
  readonly domain: string;
  readonly resource: string;
  readonly action: string;
  readonly description: string;
  readonly riskClassification: EventRisk;
  readonly active: boolean;
  readonly deprecatedAt: null;
  readonly replacementPermissionKey: null;
  readonly definitionVersion: number;
}

export interface PermissionKeyParts {
  readonly domain: string;
  readonly resource: string;
  readonly action: string;
}

export function parsePermissionKey(value: unknown): PermissionKeyParts {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > PERMISSION_KEY_MAX_LENGTH
  ) {
    throw new TypeError("Permission key is invalid");
  }
  const segments = value.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => !permissionSegmentPattern.test(segment))
  ) {
    throw new TypeError("Permission key is invalid");
  }
  const [domain, resource, action] = segments;
  if (!domain || !resource || !action)
    throw new TypeError("Permission key is invalid");
  return { domain, resource, action };
}

function permission(
  key: string,
  description: string,
  riskClassification: EventRisk,
): PermissionDefinition {
  return {
    key,
    ...parsePermissionKey(key),
    description,
    riskClassification,
    active: true,
    deprecatedAt: null,
    replacementPermissionKey: null,
    definitionVersion: PERMISSION_DEFINITION_VERSION,
  };
}

export function definePermissionRegistry(
  definitions: readonly PermissionDefinition[],
): readonly PermissionDefinition[] {
  const keys = new Set<string>();
  for (const definition of definitions) {
    const parts = parsePermissionKey(definition.key);
    if (
      keys.has(definition.key) ||
      definition.domain !== parts.domain ||
      definition.resource !== parts.resource ||
      definition.action !== parts.action ||
      definition.description.trim().length === 0 ||
      definition.description.length > 500 ||
      !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(
        definition.riskClassification,
      ) ||
      definition.active !== true ||
      definition.deprecatedAt !== null ||
      definition.replacementPermissionKey !== null ||
      !Number.isSafeInteger(definition.definitionVersion) ||
      definition.definitionVersion < 1
    ) {
      throw new TypeError(
        "Permission registry definition is invalid or duplicated",
      );
    }
    keys.add(definition.key);
  }
  return Object.freeze([...definitions]);
}

export const PERMISSION_REGISTRY = definePermissionRegistry([
  permission(
    "identity.account.read_self",
    "Read the current employee account profile.",
    "LOW",
  ),
  permission(
    "identity.account.update_self",
    "Update approved current account profile fields.",
    "MEDIUM",
  ),
  permission(
    "identity.session.read_self",
    "Read the current employee session list.",
    "LOW",
  ),
  permission(
    "identity.session.revoke_self",
    "Revoke a current employee session.",
    "MEDIUM",
  ),

  permission(
    "admin.employee.read",
    "Read organization employee identity records.",
    "LOW",
  ),
  permission(
    "admin.employee.update",
    "Update approved employee profile fields.",
    "MEDIUM",
  ),
  permission("admin.employee.invite", "Invite an internal employee.", "MEDIUM"),
  permission("admin.employee.suspend", "Suspend an employee account.", "HIGH"),
  permission(
    "admin.employee.offboard",
    "Offboard an employee and remove active access.",
    "HIGH",
  ),

  permission(
    "admin.invitation.read",
    "Read organization invitation history.",
    "LOW",
  ),
  permission(
    "admin.invitation.revoke",
    "Revoke a pending invitation.",
    "MEDIUM",
  ),
  permission(
    "admin.invitation.resend",
    "Rotate and resend or reissue an invitation.",
    "MEDIUM",
  ),

  permission(
    "admin.role.read",
    "Read organization roles and assignments.",
    "LOW",
  ),
  permission(
    "admin.role.create",
    "Create a customizable organization role.",
    "MEDIUM",
  ),
  permission(
    "admin.role.update",
    "Update approved organization role metadata.",
    "MEDIUM",
  ),
  permission("admin.role.archive", "Archive an organization role.", "MEDIUM"),
  permission("admin.role.assign", "Assign or remove an employee role.", "HIGH"),

  permission(
    "admin.permission.read",
    "Read the product permission catalog and role grant history.",
    "LOW",
  ),
  permission(
    "admin.permission.manage",
    "Grant or remove registered permissions from roles.",
    "CRITICAL",
  ),

  permission(
    "admin.session.read",
    "Read organization session metadata.",
    "LOW",
  ),
  permission(
    "admin.session.revoke",
    "Revoke an organization employee session.",
    "MEDIUM",
  ),

  permission(
    "admin.sso.read",
    "Read approved SSO configuration metadata.",
    "LOW",
  ),
  permission(
    "admin.sso.manage",
    "Manage security-sensitive SSO configuration.",
    "CRITICAL",
  ),

  permission(
    "admin.access.temporary",
    "Manage explicit time-bounded temporary access.",
    "HIGH",
  ),
  permission(
    "admin.access.revoke",
    "Revoke explicit temporary or emergency access.",
    "HIGH",
  ),
  permission(
    "admin.access.emergency",
    "Manage explicit emergency access.",
    "CRITICAL",
  ),

  permission(
    "approval.request.read",
    "Read approval request history and state.",
    "MEDIUM",
  ),
  permission(
    "approval.request.approve",
    "Approve an assigned approval request step.",
    "HIGH",
  ),
  permission(
    "approval.request.reject",
    "Reject an assigned approval request step.",
    "HIGH",
  ),

  permission(
    "security.event.read",
    "Read minimized organization security event history.",
    "HIGH",
  ),
  permission(
    "audit.event.read",
    "Read minimized organization audit event history.",
    "HIGH",
  ),
]);

const definitionsByKey = new Map(
  PERMISSION_REGISTRY.map((definition) => [definition.key, definition]),
);

export function canonicalPermissionDefinition(
  key: string,
): PermissionDefinition | null {
  return definitionsByKey.get(key) ?? null;
}

export interface PermissionDefinitionRecord {
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
}

export function permissionRecordMatchesDefinition(
  record: PermissionDefinitionRecord,
  definition: PermissionDefinition,
): boolean {
  return (
    record.key === definition.key &&
    record.domain === definition.domain &&
    record.resource === definition.resource &&
    record.action === definition.action &&
    record.description === definition.description &&
    record.riskClassification === definition.riskClassification &&
    record.active === definition.active &&
    record.deprecatedAt === definition.deprecatedAt &&
    record.replacementPermissionKey === definition.replacementPermissionKey &&
    record.definitionVersion === definition.definitionVersion
  );
}

export function permissionRecordCanBackGrant(
  record: PermissionDefinitionRecord,
  definition: PermissionDefinition,
): boolean {
  return (
    record.key === definition.key &&
    record.domain === definition.domain &&
    record.resource === definition.resource &&
    record.action === definition.action &&
    record.riskClassification === definition.riskClassification &&
    record.active &&
    record.deprecatedAt === null &&
    record.replacementPermissionKey === definition.replacementPermissionKey &&
    record.definitionVersion === definition.definitionVersion
  );
}
