import type {
  GrantRolePermissionInput,
  ScopeType,
} from "./permission.contracts.js";
import { SCOPE_TYPES } from "./permission.contracts.js";
import {
  invalidPermissionInput,
  invalidPermissionRequest,
} from "./permission.errors.js";
import { parsePermissionKey } from "./permission-manifest.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const bindingTypePattern = /^[a-z][a-z0-9._-]*$/u;
const bindingIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalidPermissionInput();
  return input as Record<string, unknown>;
}

function assertKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw invalidPermissionInput();
}

export function parsePermissionKeyInput(value: unknown): string {
  try {
    parsePermissionKey(value);
  } catch {
    throw invalidPermissionInput();
  }
  return value as string;
}

export function parsePermissionRoleId(value: string): string {
  if (!uuidPattern.test(value)) throw invalidPermissionRequest();
  return value.toLowerCase();
}

export function parsePermissionPagination(
  pageInput?: string,
  pageSizeInput?: string,
) {
  const parse = (
    value: string | undefined,
    fallback: number,
    maximum: number,
  ): number => {
    if (value === undefined) return fallback;
    if (!/^\d+$/u.test(value)) throw invalidPermissionRequest();
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
      throw invalidPermissionRequest();
    }
    return number;
  };
  return {
    page: parse(pageInput, 1, 1_000_000),
    pageSize: parse(pageSizeInput, 50, 100),
  };
}

function optionalBinding(
  value: unknown,
  maximum: number,
  pattern: RegExp,
): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !pattern.test(value)
  ) {
    throw invalidPermissionInput();
  }
  return value;
}

export function parseGrantRolePermission(
  input: unknown,
): GrantRolePermissionInput {
  const body = objectInput(input);
  assertKeys(body, [
    "permissionKey",
    "scopeType",
    "scopeBindingType",
    "scopeBindingId",
    "expiresAt",
  ]);
  const permissionKey = parsePermissionKeyInput(body.permissionKey);
  if (
    typeof body.scopeType !== "string" ||
    !SCOPE_TYPES.includes(body.scopeType as ScopeType)
  ) {
    throw invalidPermissionInput();
  }
  const scopeType = body.scopeType as ScopeType;
  const scopeBindingType = optionalBinding(
    body.scopeBindingType,
    80,
    bindingTypePattern,
  );
  const scopeBindingId = optionalBinding(
    body.scopeBindingId,
    128,
    bindingIdPattern,
  );
  if ((scopeBindingType === null) !== (scopeBindingId === null))
    throw invalidPermissionInput();
  if (scopeType === "SELF" || scopeType === "ORGANIZATION") {
    if (scopeBindingType !== null || scopeBindingId !== null)
      throw invalidPermissionInput();
  }
  if (
    scopeType === "EXPLICIT" &&
    (scopeBindingType === null || scopeBindingId === null)
  ) {
    throw invalidPermissionInput();
  }
  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== "string" || body.expiresAt.length > 40) {
      throw invalidPermissionInput();
    }
    expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) throw invalidPermissionInput();
  }
  return {
    permissionKey,
    scopeType,
    scopeBindingType,
    scopeBindingId,
    expiresAt,
  };
}
