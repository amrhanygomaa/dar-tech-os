import { createHash } from "node:crypto";
import { AUTHORIZATION_RESOURCE_TYPES } from "../authorization/authorization.contracts.js";
import { SCOPE_TYPES } from "../permissions/permission.contracts.js";
import { canonicalPermissionDefinition } from "../permissions/permission-manifest.js";
import { temporaryAccessInvalid } from "./temporary-access.errors.js";
import type {
  TemporaryAccessBindingInput,
  TemporaryAccessEffectiveStatus,
} from "./temporary-access.contracts.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

export function sha256(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export function parseTemporaryAccessId(value: string): string {
  if (!UUID.test(value)) throw temporaryAccessInvalid();
  return value;
}

export function parseTemporaryAccessCreate(
  body: unknown,
  idempotencyKey: unknown,
  now: Date,
  maximumDurationSeconds: number,
): {
  readonly reason: string;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly approvalReference: string | null;
  readonly idempotencyKey: string;
  readonly bindings: readonly TemporaryAccessBindingInput[];
} {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw temporaryAccessInvalid();
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "reason",
          "startsAt",
          "expiresAt",
          "bindings",
          "approvalReference",
        ].includes(key),
    )
  )
    throw temporaryAccessInvalid();
  if (
    typeof idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY.test(idempotencyKey)
  )
    throw temporaryAccessInvalid();
  if (
    typeof value.reason !== "string" ||
    value.reason.trim().length < 1 ||
    value.reason.trim().length > 500 ||
    /[\p{Cc}\p{Cf}]/u.test(value.reason)
  )
    throw temporaryAccessInvalid();
  const startsAt =
    typeof value.startsAt === "string"
      ? new Date(value.startsAt)
      : new Date(Number.NaN);
  const expiresAt =
    typeof value.expiresAt === "string"
      ? new Date(value.expiresAt)
      : new Date(Number.NaN);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(expiresAt.getTime()) ||
    startsAt >= expiresAt ||
    expiresAt <= now ||
    expiresAt.getTime() - startsAt.getTime() > maximumDurationSeconds * 1000
  )
    throw temporaryAccessInvalid();
  const approvalReference =
    value.approvalReference === undefined
      ? null
      : typeof value.approvalReference === "string" &&
          UUID.test(value.approvalReference)
        ? value.approvalReference
        : (() => {
            throw temporaryAccessInvalid();
          })();
  if (
    !Array.isArray(value.bindings) ||
    value.bindings.length < 1 ||
    value.bindings.length > 50
  )
    throw temporaryAccessInvalid();
  const bindings = value.bindings.map((entry): TemporaryAccessBindingInput => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw temporaryAccessInvalid();
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).some(
        (key) =>
          ![
            "permissionKey",
            "scopeType",
            "resourceType",
            "resourceId",
          ].includes(key),
      )
    )
      throw temporaryAccessInvalid();
    if (
      typeof item.permissionKey !== "string" ||
      !canonicalPermissionDefinition(item.permissionKey) ||
      item.permissionKey.includes("*")
    )
      throw temporaryAccessInvalid();
    if (
      typeof item.scopeType !== "string" ||
      !SCOPE_TYPES.includes(item.scopeType as never) ||
      item.scopeType === "SELF" ||
      item.scopeType.includes("*")
    )
      throw temporaryAccessInvalid();
    if (
      typeof item.resourceType !== "string" ||
      !AUTHORIZATION_RESOURCE_TYPES.includes(item.resourceType as never) ||
      item.resourceType.includes("*")
    )
      throw temporaryAccessInvalid();
    const organizationScope = item.scopeType === "ORGANIZATION";
    const resourceId =
      item.resourceId === undefined || item.resourceId === null
        ? null
        : typeof item.resourceId === "string" &&
            RESOURCE_ID.test(item.resourceId) &&
            !item.resourceId.includes("*")
          ? item.resourceId
          : (() => {
              throw temporaryAccessInvalid();
            })();
    if (
      (organizationScope && resourceId !== null) ||
      (!organizationScope && resourceId === null)
    )
      throw temporaryAccessInvalid();
    return {
      permissionKey: item.permissionKey,
      scopeType: item.scopeType as TemporaryAccessBindingInput["scopeType"],
      resourceType:
        item.resourceType as TemporaryAccessBindingInput["resourceType"],
      resourceId,
    };
  });
  const normalized = [...bindings].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  if (
    new Set(normalized.map((binding) => JSON.stringify(binding))).size !==
    normalized.length
  )
    throw temporaryAccessInvalid();
  return {
    reason: value.reason.trim(),
    startsAt,
    expiresAt,
    approvalReference,
    idempotencyKey,
    bindings: normalized,
  };
}

export function parseTemporaryAccessList(
  page?: string,
  pageSize?: string,
  status?: string,
  recipientEmployeeId?: string,
) {
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedPageSize = pageSize === undefined ? 25 : Number(pageSize);
  const statuses: readonly TemporaryAccessEffectiveStatus[] = [
    "PENDING_APPROVAL",
    "SCHEDULED",
    "ACTIVE",
    "REVOKED",
    "EXPIRED",
  ];
  if (
    !Number.isInteger(parsedPage) ||
    parsedPage < 1 ||
    parsedPage > 1_000_000 ||
    !Number.isInteger(parsedPageSize) ||
    parsedPageSize < 1 ||
    parsedPageSize > 100 ||
    (status !== undefined &&
      !statuses.includes(status as TemporaryAccessEffectiveStatus)) ||
    (recipientEmployeeId !== undefined && !UUID.test(recipientEmployeeId))
  )
    throw temporaryAccessInvalid();
  return {
    page: parsedPage,
    pageSize: parsedPageSize,
    ...(status ? { status: status as TemporaryAccessEffectiveStatus } : {}),
    ...(recipientEmployeeId ? { recipientEmployeeId } : {}),
  };
}
