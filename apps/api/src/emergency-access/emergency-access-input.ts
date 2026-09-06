import { createHash } from 'node:crypto';
import { AUTHORIZATION_RESOURCE_TYPES } from '../authorization/authorization.contracts.js';
import { EVENT_RISKS, type EventRisk } from '../event-history/event-history.contracts.js';
import { canonicalPermissionDefinition } from '../permissions/permission-manifest.js';
import { SCOPE_TYPES } from '../permissions/permission.contracts.js';
import type { EmergencyAccessBindingInput, EmergencyAccessStoredStatus } from './emergency-access.contracts.js';
import { emergencyAccessInvalid } from './emergency-access.errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

export function emergencySha256(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export function parseEmergencyAccessId(value: string): string {
  if (!UUID.test(value)) throw emergencyAccessInvalid();
  return value;
}

export function parseEmergencyAccessRequest(
  body: unknown,
  idempotencyKey: unknown,
  now: Date,
  maximumDurationSeconds: number,
): {
  readonly recipientEmployeeId: string;
  readonly reason: string;
  readonly requestedRisk: EventRisk;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly idempotencyKey: string;
  readonly bindings: readonly EmergencyAccessBindingInput[];
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw emergencyAccessInvalid();
  const value = body as Record<string, unknown>;
  const allowed = ['recipientEmployeeId', 'reason', 'risk', 'startsAt', 'expiresAt', 'bindings'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw emergencyAccessInvalid();
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey)) throw emergencyAccessInvalid();
  if (typeof value.recipientEmployeeId !== 'string' || !UUID.test(value.recipientEmployeeId)) throw emergencyAccessInvalid();
  if (typeof value.reason !== 'string' || value.reason.trim().length < 1 || value.reason.trim().length > 500 || /[\p{Cc}\p{Cf}]/u.test(value.reason)) throw emergencyAccessInvalid();
  if (typeof value.risk !== 'string' || !EVENT_RISKS.includes(value.risk as EventRisk)) throw emergencyAccessInvalid();
  const startsAt = typeof value.startsAt === 'string' ? new Date(value.startsAt) : new Date(Number.NaN);
  const expiresAt = typeof value.expiresAt === 'string' ? new Date(value.expiresAt) : new Date(Number.NaN);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || startsAt >= expiresAt || expiresAt <= now || expiresAt.getTime() - startsAt.getTime() > maximumDurationSeconds * 1000) throw emergencyAccessInvalid();
  if (!Array.isArray(value.bindings) || value.bindings.length < 1 || value.bindings.length > 50) throw emergencyAccessInvalid();
  const bindings = value.bindings.map((entry): EmergencyAccessBindingInput => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw emergencyAccessInvalid();
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).some((key) => !['permissionKey', 'scopeType', 'resourceType', 'resourceId'].includes(key))) throw emergencyAccessInvalid();
    if (typeof item.permissionKey !== 'string' || !canonicalPermissionDefinition(item.permissionKey) || item.permissionKey.includes('*')) throw emergencyAccessInvalid();
    if (typeof item.scopeType !== 'string' || !SCOPE_TYPES.includes(item.scopeType as never) || item.scopeType === 'SELF' || item.scopeType.includes('*')) throw emergencyAccessInvalid();
    if (typeof item.resourceType !== 'string' || !AUTHORIZATION_RESOURCE_TYPES.includes(item.resourceType as never) || item.resourceType.includes('*')) throw emergencyAccessInvalid();
    const organizationScope = item.scopeType === 'ORGANIZATION';
    const resourceId = item.resourceId === undefined || item.resourceId === null
      ? null
      : typeof item.resourceId === 'string' && RESOURCE_ID.test(item.resourceId) && !item.resourceId.includes('*')
        ? item.resourceId
        : (() => { throw emergencyAccessInvalid(); })();
    if ((organizationScope && resourceId !== null) || (!organizationScope && resourceId === null)) throw emergencyAccessInvalid();
    return {
      permissionKey: item.permissionKey,
      scopeType: item.scopeType as EmergencyAccessBindingInput['scopeType'],
      resourceType: item.resourceType as EmergencyAccessBindingInput['resourceType'],
      resourceId,
    };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (new Set(bindings.map((binding) => JSON.stringify(binding))).size !== bindings.length) throw emergencyAccessInvalid();
  return {
    recipientEmployeeId: value.recipientEmployeeId,
    reason: value.reason.trim(),
    requestedRisk: value.risk as EventRisk,
    startsAt,
    expiresAt,
    idempotencyKey,
    bindings,
  };
}

export function parseEmergencyAccessList(page?: string, pageSize?: string, status?: string, recipientEmployeeId?: string, risk?: string) {
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedPageSize = pageSize === undefined ? 25 : Number(pageSize);
  const statuses: readonly EmergencyAccessStoredStatus[] = ['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE', 'ACTIVE', 'DENIED', 'REVOKED', 'EXPIRED'];
  if (!Number.isInteger(parsedPage) || parsedPage < 1 || parsedPage > 1_000_000 || !Number.isInteger(parsedPageSize) || parsedPageSize < 1 || parsedPageSize > 100 || (status !== undefined && !statuses.includes(status as EmergencyAccessStoredStatus)) || (recipientEmployeeId !== undefined && !UUID.test(recipientEmployeeId)) || (risk !== undefined && !EVENT_RISKS.includes(risk as EventRisk))) throw emergencyAccessInvalid();
  return {
    page: parsedPage,
    pageSize: parsedPageSize,
    ...(status ? { status: status as EmergencyAccessStoredStatus } : {}),
    ...(recipientEmployeeId ? { recipientEmployeeId } : {}),
    ...(risk ? { risk: risk as EventRisk } : {}),
  };
}

export function riskMaximum(values: readonly EventRisk[]): EventRisk {
  const rank: Record<EventRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  return values.reduce((highest, value) => rank[value] > rank[highest] ? value : highest, 'LOW');
}

export function emergencySafeContext(input: {
  readonly grantId: string;
  readonly recipientEmployeeId: string;
  readonly reason: string;
  readonly requestedRisk: EventRisk;
  readonly effectiveRisk: EventRisk;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly bindings: readonly (EmergencyAccessBindingInput & { readonly riskClassification: EventRisk })[];
}) {
  return {
    operation: 'emergency_access_activate',
    grantId: input.grantId,
    recipientEmployeeId: input.recipientEmployeeId,
    bindingFingerprint: emergencySha256(JSON.stringify(input.bindings.map((binding) => ({
      permissionKey: binding.permissionKey,
      riskClassification: binding.riskClassification,
      scopeType: binding.scopeType,
      resourceType: binding.resourceType,
      resourceId: binding.resourceId,
    })))),
    reasonFingerprint: emergencySha256(input.reason),
    requestedRisk: input.requestedRisk,
    effectiveRisk: input.effectiveRisk,
    startsAt: input.startsAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  } as const;
}
