import { ApplicationError } from '@dar-tech/observability';
import { API_ERROR_CODES } from '@dar-tech/types';
import {
  EVENT_RISKS,
  type AuditEventAppendInput,
  type AuditEventFilters,
  type EventRisk,
  type SecurityEventAppendInput,
  type SecurityEventFilters,
} from './event-history.contracts.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const boundedKeyPattern = /^[A-Za-z][A-Za-z0-9._-]*$/u;
const forbiddenContextKeyPattern =
  /(?:password|secret|token|nonce|state|authorization|email|subject|stack|raw|payload|login.?hint|code)/iu;
const allowedChangedFields = new Set(['displayName', 'firstName', 'lastName', 'workEmail']);

function invalidRequest(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.invalidRequest,
    400,
    'Request could not be processed',
  );
}

function requireBoundedString(value: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    !boundedKeyPattern.test(normalized)
  ) {
    throw new Error('Unsafe event history input');
  }
  return normalized;
}

function optionalBoundedText(value: string, maximum: number): string;
function optionalBoundedText(value: undefined, maximum: number): undefined;
function optionalBoundedText(value: string | undefined, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error('Unsafe event history input');
  }
  return normalized;
}

function requireUuid(value: string): string {
  if (!uuidPattern.test(value)) throw new Error('Unsafe event history input');
  return value.toLowerCase();
}

function validateVersion(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Unsafe event history input');
  }
  return value;
}

function validateSnapshot(
  snapshot: AuditEventAppendInput['actorSnapshot'],
): AuditEventAppendInput['actorSnapshot'] {
  if (!['employee', 'system', 'unresolved'].includes(snapshot.type)) {
    throw new Error('Unsafe event history input');
  }
  return {
    type: snapshot.type,
    ...(snapshot.displayName
      ? { displayName: optionalBoundedText(snapshot.displayName, 160)! }
      : {}),
    ...(snapshot.employeeCode
      ? { employeeCode: optionalBoundedText(snapshot.employeeCode, 64)! }
      : {}),
  };
}

function validateSafeContext(
  context: SecurityEventAppendInput['safeContext'],
): SecurityEventAppendInput['safeContext'] {
  if (!context) return undefined;
  const entries = Object.entries(context);
  if (entries.length > 16) throw new Error('Unsafe event history input');
  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (
        !boundedKeyPattern.test(key) ||
        key.length > 64 ||
        forbiddenContextKeyPattern.test(key) ||
        (typeof value === 'string' && value.length > 256) ||
        (typeof value === 'number' && !Number.isFinite(value))
      ) {
        throw new Error('Unsafe event history input');
      }
      return [key, value];
    }),
  );
}

export function validateAuditEventAppend(input: AuditEventAppendInput): AuditEventAppendInput {
  const changedFields = input.changeDelta?.changedFields;
  if (
    changedFields &&
    (changedFields.length === 0 ||
      changedFields.length > allowedChangedFields.size ||
      changedFields.some((field) => !allowedChangedFields.has(field)))
  ) {
    throw new Error('Unsafe event history input');
  }
  const eventVersion = validateVersion(input.eventVersion);
  const integrityVersion = validateVersion(input.integrityVersion);
  return {
    ...input,
    organizationId: requireUuid(input.organizationId),
    actionKey: requireBoundedString(input.actionKey, 160) as AuditEventAppendInput['actionKey'],
    ...(input.actorEmployeeId ? { actorEmployeeId: requireUuid(input.actorEmployeeId) } : {}),
    actorSnapshot: validateSnapshot(input.actorSnapshot),
    targetType: requireBoundedString(input.targetType, 80),
    targetId: optionalBoundedText(input.targetId, 128)!,
    ...(input.targetSnapshot
      ? {
          targetSnapshot: {
            ...(input.targetSnapshot.displayName
              ? {
                  displayName: optionalBoundedText(input.targetSnapshot.displayName, 160)!,
                }
              : {}),
            ...(input.targetSnapshot.employeeCode
              ? {
                  employeeCode: optionalBoundedText(input.targetSnapshot.employeeCode, 64)!,
                }
              : {}),
          },
        }
      : {}),
    ...(input.requestId ? { requestId: optionalBoundedText(input.requestId, 128) } : {}),
    correlationId: optionalBoundedText(input.correlationId, 128)!,
    ...(input.sessionReference
      ? { sessionReference: optionalBoundedText(input.sessionReference, 128) }
      : {}),
    ...(input.safeReason ? { safeReason: optionalBoundedText(input.safeReason, 1024) } : {}),
    ...(changedFields
      ? { changeDelta: { changedFields: [...new Set(changedFields)].sort() } }
      : {}),
    ...(input.approvalReference
      ? { approvalReference: optionalBoundedText(input.approvalReference, 128) }
      : {}),
    ...(eventVersion ? { eventVersion } : {}),
    ...(integrityVersion ? { integrityVersion } : {}),
  };
}

export function validateSecurityEventAppend(
  input: SecurityEventAppendInput,
): SecurityEventAppendInput {
  if ((input.actorEmployeeId || input.actorAccountId) && !input.organizationId) {
    throw new Error('Unsafe event history input');
  }
  const eventVersion = validateVersion(input.eventVersion);
  return {
    ...input,
    ...(input.organizationId ? { organizationId: requireUuid(input.organizationId) } : {}),
    eventType: requireBoundedString(input.eventType, 160) as SecurityEventAppendInput['eventType'],
    category: requireBoundedString(input.category, 80),
    outcome: requireBoundedString(input.outcome, 64),
    ...(input.actorEmployeeId ? { actorEmployeeId: requireUuid(input.actorEmployeeId) } : {}),
    ...(input.actorAccountId ? { actorAccountId: requireUuid(input.actorAccountId) } : {}),
    ...(input.providerKey ? { providerKey: requireBoundedString(input.providerKey, 64) } : {}),
    ...(input.sessionReference
      ? { sessionReference: optionalBoundedText(input.sessionReference, 128) }
      : {}),
    ...(input.actorSnapshot ? { actorSnapshot: validateSnapshot(input.actorSnapshot) } : {}),
    ...(input.safeContext ? { safeContext: validateSafeContext(input.safeContext)! } : {}),
    ...(input.requestId ? { requestId: optionalBoundedText(input.requestId, 128) } : {}),
    correlationId: optionalBoundedText(input.correlationId, 128)!,
    ...(input.networkContext
      ? {
          networkContext: {
            ...(input.networkContext.countryCode
              ? {
                  countryCode: optionalBoundedText(input.networkContext.countryCode, 2)!,
                }
              : {}),
            ...(input.networkContext.ipPrefix
              ? {
                  ipPrefix: optionalBoundedText(input.networkContext.ipPrefix, 64)!,
                }
              : {}),
          },
        }
      : {}),
    ...(input.deviceContext
      ? {
          deviceContext: {
            ...(input.deviceContext.deviceClass
              ? {
                  deviceClass: requireBoundedString(input.deviceContext.deviceClass, 32),
                }
              : {}),
            ...(input.deviceContext.userAgentFamily
              ? {
                  userAgentFamily: requireBoundedString(input.deviceContext.userAgentFamily, 64),
                }
              : {}),
          },
        }
      : {}),
    ...(eventVersion ? { eventVersion } : {}),
  };
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw invalidRequest();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw invalidRequest();
  return parsed;
}

function parseFilterKey(value: string | undefined, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    !boundedKeyPattern.test(normalized)
  ) {
    throw invalidRequest();
  }
  return normalized;
}

function parseOccurred(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  if (value.length > 40) throw invalidRequest();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalidRequest();
  return date;
}

function occurredRange(
  fromInput: string | undefined,
  toInput: string | undefined,
): { occurredFrom?: Date; occurredTo?: Date } {
  const occurredFrom = parseOccurred(fromInput);
  const occurredTo = parseOccurred(toInput);
  if (occurredFrom && occurredTo && occurredFrom > occurredTo) throw invalidRequest();
  return {
    ...(occurredFrom ? { occurredFrom } : {}),
    ...(occurredTo ? { occurredTo } : {}),
  };
}

export function parseAuditEventQuery(input: {
  readonly page?: string;
  readonly pageSize?: string;
  readonly actionKey?: string;
  readonly targetType?: string;
  readonly occurredFrom?: string;
  readonly occurredTo?: string;
}): { page: number; pageSize: number; filters: AuditEventFilters } {
  const actionKey = parseFilterKey(input.actionKey, 160);
  const targetType = parseFilterKey(input.targetType, 80);
  return {
    page: parsePositiveInteger(input.page, 1, 1_000_000),
    pageSize: parsePositiveInteger(input.pageSize, 50, 100),
    filters: {
      ...(actionKey ? { actionKey } : {}),
      ...(targetType ? { targetType } : {}),
      ...occurredRange(input.occurredFrom, input.occurredTo),
    },
  };
}

export function parseSecurityEventQuery(input: {
  readonly page?: string;
  readonly pageSize?: string;
  readonly eventType?: string;
  readonly category?: string;
  readonly outcome?: string;
  readonly risk?: string;
  readonly occurredFrom?: string;
  readonly occurredTo?: string;
}): { page: number; pageSize: number; filters: SecurityEventFilters } {
  const risk = parseFilterKey(input.risk, 16);
  const eventType = parseFilterKey(input.eventType, 160);
  const category = parseFilterKey(input.category, 80);
  const outcome = parseFilterKey(input.outcome, 64);
  if (risk && !EVENT_RISKS.includes(risk as EventRisk)) throw invalidRequest();
  return {
    page: parsePositiveInteger(input.page, 1, 1_000_000),
    pageSize: parsePositiveInteger(input.pageSize, 50, 100),
    filters: {
      ...(eventType ? { eventType } : {}),
      ...(category ? { category } : {}),
      ...(outcome ? { outcome } : {}),
      ...(risk ? { risk: risk as EventRisk } : {}),
      ...occurredRange(input.occurredFrom, input.occurredTo),
    },
  };
}

export function parseEventId(value: string): string {
  if (!uuidPattern.test(value)) throw invalidRequest();
  return value.toLowerCase();
}
