import { createHash } from 'node:crypto';
import { lifecycleInvalid } from './offboarding.errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function lifecycleFingerprint(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export function parseLifecycleEmployeeId(value: string): string {
  if (!UUID.test(value)) throw lifecycleInvalid();
  return value.toLowerCase();
}

export function parseLifecycleReasonBody(body: unknown): {
  readonly reason: string;
  readonly approvalReference: string | null;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw lifecycleInvalid();
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['reason', 'approvalReference'].includes(key))) {
    throw lifecycleInvalid();
  }
  if (
    typeof value.reason !== 'string' ||
    value.reason.trim().length === 0 ||
    value.reason.trim().length > 500 ||
    /[\p{Cc}\p{Cf}]/u.test(value.reason)
  ) {
    throw lifecycleInvalid();
  }
  const approvalReference = value.approvalReference === undefined
    ? null
    : typeof value.approvalReference === 'string' && UUID.test(value.approvalReference)
      ? value.approvalReference.toLowerCase()
      : (() => { throw lifecycleInvalid(); })();
  return { reason: value.reason.trim(), approvalReference };
}

export function parseArchiveBody(body: unknown): void {
  if (body === undefined || body === null) return;
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
    throw lifecycleInvalid();
  }
}
