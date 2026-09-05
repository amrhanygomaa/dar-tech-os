import { ApplicationError } from "@dar-tech/observability";
import { API_ERROR_CODES } from "@dar-tech/types";
import { canonicalPermissionDefinition } from "../permissions/permission-manifest.js";
import { AUTHORIZATION_RESOURCE_TYPES } from "../authorization/authorization.contracts.js";
import type {
  ApprovalListFilters,
  ApprovalPolicyResolverInput,
  PrepareApprovalInput,
} from "./approval.contracts.js";

/** Project the contract so extra fields on a caller object never reach a resolver. */
export function boundedApprovalPolicyInput(
  input: ApprovalPolicyResolverInput,
): ApprovalPolicyResolverInput {
  validateApprovalPolicyInput(input);
  const actorKeys = [
    "actorType",
    "sessionId",
    "organizationId",
    "employeeId",
    "userAccountId",
    "clientKind",
    "assuranceLevel",
    "authenticatedAt",
    "lastStepUpAt",
    "issuedAt",
    "lastSeenAt",
    "idleExpiresAt",
    "absoluteExpiresAt",
  ] as const;
  const actor = Object.fromEntries(
    actorKeys.map((key) => {
      const value = input.actor[key];
      return [key, value instanceof Date ? new Date(value.getTime()) : value];
    }),
  ) as unknown as ApprovalPolicyResolverInput["actor"];
  const { type, organizationId, id, ownerEmployeeId, ownerUserAccountId } =
    input.resource;
  return {
    actor,
    action: input.action,
    risk: input.risk,
    at: new Date(input.at.getTime()),
    context: { ...input.context },
    resource: {
      type,
      organizationId,
      ...(id ? { id } : {}),
      ...(ownerEmployeeId ? { ownerEmployeeId } : {}),
      ...(ownerUserAccountId ? { ownerUserAccountId } : {}),
    },
  };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalid(): never {
  throw new ApplicationError(
    API_ERROR_CODES.approvalInputInvalid,
    422,
    "Approval input is invalid",
  );
}

export function parseApprovalId(value: string): string {
  if (!UUID.test(value)) invalid();
  return value;
}

export function parseApprovalPagination(
  page?: string,
  pageSize?: string,
): { page: number; pageSize: number } {
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedSize = pageSize === undefined ? 25 : Number(pageSize);
  if (
    !Number.isInteger(parsedPage) ||
    parsedPage < 1 ||
    parsedPage > 1_000_000 ||
    !Number.isInteger(parsedSize) ||
    parsedSize < 1 ||
    parsedSize > 100
  )
    invalid();
  return { page: parsedPage, pageSize: parsedSize };
}

export function parseApprovalFilters(
  status?: string,
  risk?: string,
): ApprovalListFilters {
  if (
    status !== undefined &&
    ![
      "PENDING",
      "IN_REVIEW",
      "APPROVED",
      "REJECTED",
      "EXECUTED",
      "FAILED",
    ].includes(status)
  )
    invalid();
  if (
    risk !== undefined &&
    !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(risk)
  )
    invalid();
  return {
    ...(status ? { status: status as ApprovalListFilters["status"] } : {}),
    ...(risk ? { risk: risk as ApprovalListFilters["risk"] } : {}),
  } as ApprovalListFilters;
}

export function parseApprovalDecision(value: unknown): {
  stepId: string;
  expectedVersion: number;
  reason: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => !["stepId", "expectedVersion", "reason"].includes(key),
    )
  )
    invalid();
  if (typeof body.stepId !== "string" || !UUID.test(body.stepId)) invalid();
  if (
    !Number.isInteger(body.expectedVersion) ||
    Number(body.expectedVersion) < 1 ||
    Number(body.expectedVersion) > 2_147_483_647
  )
    invalid();
  if (body.reason !== undefined && !safeText(body.reason, 500)) invalid();
  return {
    stepId: body.stepId,
    expectedVersion: Number(body.expectedVersion),
    reason:
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : null,
  };
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

/** Snapshots have a deliberately small public presentation contract, not arbitrary payloads. */
export function validApprovalSnapshot(
  value: unknown,
): value is Readonly<Record<string, string>> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        ["displayName", "label"].includes(key) && safeText(item, 160),
    )
  );
}

export function validateApprovalPolicyInput(
  input: ApprovalPolicyResolverInput,
): void {
  const definition = canonicalPermissionDefinition(input.action);
  if (
    !definition ||
    definition.riskClassification !== input.risk ||
    !AUTHORIZATION_RESOURCE_TYPES.includes(input.resource.type) ||
    input.resource.organizationId !== input.actor.organizationId ||
    [
      input.resource.id,
      input.resource.ownerEmployeeId,
      input.resource.ownerUserAccountId,
    ].some(
      (value) =>
        value !== undefined && (!safeText(value, 128) || value.length === 0),
    ) ||
    !(input.at instanceof Date) ||
    !Number.isFinite(input.at.getTime())
  )
    invalid();
  if (
    !input.context ||
    typeof input.context !== "object" ||
    Array.isArray(input.context)
  )
    invalid();
  const entries = Object.entries(input.context);
  if (
    entries.length > 32 ||
    entries.some(
      ([key, value]) =>
        !/^[a-z][a-zA-Z0-9._-]{0,63}$/u.test(key) ||
        /token|secret|password|cookie|authorization|credential|assurance|stepup/iu.test(
          key,
        ) ||
        !(
          value === null ||
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)) ||
          safeText(value, 256)
        ),
    )
  )
    invalid();
}

export function validatePrepareApprovalInput(
  input: PrepareApprovalInput,
): void {
  validateApprovalPolicyInput({ ...input, context: input.safeContext });
  if (
    !validApprovalSnapshot(input.requesterSnapshot) ||
    (input.resourceSnapshot !== undefined &&
      !validApprovalSnapshot(input.resourceSnapshot)) ||
    (input.safeReason !== undefined && !safeText(input.safeReason, 500)) ||
    !safeText(input.idempotencyMaterial, 256) ||
    !input.idempotencyMaterial.length ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.correlationId)
  )
    invalid();
}
