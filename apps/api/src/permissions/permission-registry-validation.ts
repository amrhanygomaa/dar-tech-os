import type {
  PermissionRegistryIssue,
  PermissionRegistryValidationResult,
} from "./permission.contracts.js";
import {
  parsePermissionKey,
  permissionRecordCanBackGrant,
  permissionRecordMatchesDefinition,
  type PermissionDefinition,
  type PermissionDefinitionRecord,
} from "./permission-manifest.js";

export interface PersistedPermissionRecord extends PermissionDefinitionRecord {
  readonly id: string;
}

export interface PersistedGrantReference {
  readonly id: string;
  readonly permission: PersistedPermissionRecord;
}

export function validatePermissionRegistryRecords(
  definitions: readonly PermissionDefinition[],
  permissions: readonly PersistedPermissionRecord[],
  grantReferences: readonly PersistedGrantReference[],
): PermissionRegistryValidationResult {
  const issues: PermissionRegistryIssue[] = [];
  const definitionsByKey = new Map(
    definitions.map((definition) => [definition.key, definition]),
  );
  const byKey = new Map<string, PersistedPermissionRecord[]>();
  for (const permission of permissions) {
    const current = byKey.get(permission.key) ?? [];
    current.push(permission);
    byKey.set(permission.key, current);
    try {
      parsePermissionKey(permission.key);
    } catch {
      issues.push({ code: "MALFORMED_KEY", permissionKey: permission.key });
    }
    if (!definitionsByKey.has(permission.key) && permission.active) {
      issues.push({
        code: "ACTIVE_UNKNOWN_PERMISSION",
        permissionKey: permission.key,
      });
    }
  }
  for (const [key, records] of byKey) {
    if (records.length > 1)
      issues.push({ code: "DUPLICATE_KEY", permissionKey: key });
  }
  for (const definition of definitions) {
    const records = byKey.get(definition.key) ?? [];
    if (records.length === 0) {
      issues.push({
        code: "REQUIRED_KEY_MISSING",
        permissionKey: definition.key,
      });
      continue;
    }
    const record = records[0];
    if (!record) continue;
    if (record.definitionVersion !== definition.definitionVersion) {
      issues.push({
        code: "INCOMPATIBLE_DEFINITION_VERSION",
        permissionKey: definition.key,
      });
    }
    if (!permissionRecordMatchesDefinition(record, definition)) {
      issues.push({ code: "METADATA_MISMATCH", permissionKey: definition.key });
    }
  }
  for (const reference of grantReferences) {
    const definition = definitionsByKey.get(reference.permission.key);
    if (
      !definition ||
      !permissionRecordCanBackGrant(reference.permission, definition)
    ) {
      issues.push({
        code: "INVALID_GRANT_REFERENCE",
        permissionKey: reference.permission.key,
        rolePermissionId: reference.id,
      });
    }
  }
  issues.sort((left, right) =>
    `${left.code}:${left.permissionKey}:${left.rolePermissionId ?? ""}`.localeCompare(
      `${right.code}:${right.permissionKey}:${right.rolePermissionId ?? ""}`,
    ),
  );
  return {
    valid: issues.length === 0,
    canonicalCount: definitions.length,
    persistedCount: permissions.length,
    issues,
  };
}
