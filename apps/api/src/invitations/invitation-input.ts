import type { InviteEmployeeInput } from './invitation.contracts.js';
import { invalidInvitationRequest } from './invitation.errors.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const unsafeReasonPattern = /(?:[?#](?:invite|token)=|bearer\s+|[A-Za-z0-9_-]{43,})/iu;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
function hasOnlyKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(input).every((key) => allowed.has(key));
}

function normalizedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw invalidInvitationRequest();
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length < 1 || normalized.length > maximum) {
    throw invalidInvitationRequest();
  }
  return normalized;
}

export function normalizeInvitationEmail(value: unknown): string {
  if (typeof value !== 'string') throw invalidInvitationRequest();
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !emailPattern.test(normalized)) {
    throw invalidInvitationRequest();
  }
  return normalized;
}

export function parseInviteEmployee(input: unknown): InviteEmployeeInput {
  const allowed = new Set(['employeeCode', 'firstName', 'lastName', 'displayName', 'workEmail']);
  if (!isPlainRecord(input) || !hasOnlyKeys(input, allowed) || Object.keys(input).length !== 5) {
    throw invalidInvitationRequest();
  }
  return {
    employeeCode: normalizedText(input.employeeCode, 64),
    firstName: normalizedText(input.firstName, 100),
    lastName: normalizedText(input.lastName, 100),
    displayName: normalizedText(input.displayName, 160),
    workEmail: normalizeInvitationEmail(input.workEmail),
  };
}

export function parseInvitationSecretBody(input: unknown): string {
  if (
    !isPlainRecord(input) ||
    !hasOnlyKeys(input, new Set(['invitationToken'])) ||
    typeof input.invitationToken !== 'string'
  ) {
    throw invalidInvitationRequest();
  }
  return input.invitationToken;
}

export function parseOnboardingStart(input: unknown): {
  readonly invitationToken: string;
  readonly authenticationInput: { readonly redirectUri: string; readonly loginHint?: string };
} {
  if (
    !isPlainRecord(input) ||
    !hasOnlyKeys(input, new Set(['invitationToken', 'redirectUri', 'loginHint'])) ||
    typeof input.invitationToken !== 'string'
  ) {
    throw invalidInvitationRequest();
  }
  return {
    invitationToken: input.invitationToken,
    authenticationInput: {
      redirectUri: input.redirectUri as string,
      ...(input.loginHint === undefined ? {} : { loginHint: input.loginHint as string }),
    },
  };
}

export function parseInvitationId(value: string): string {
  if (!uuidPattern.test(value)) throw invalidInvitationRequest();
  return value.toLowerCase();
}

export function parseInvitationPagination(
  pageInput?: string,
  pageSizeInput?: string,
): { readonly page: number; readonly pageSize: number } {
  const page = pageInput === undefined ? 1 : Number(pageInput);
  const pageSize = pageSizeInput === undefined ? 50 : Number(pageSizeInput);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw invalidInvitationRequest();
  }
  return { page, pageSize };
}

export function parseRevocation(input: unknown): { readonly safeReason?: string } {
  if (!isPlainRecord(input) || !hasOnlyKeys(input, new Set(['reason']))) {
    throw invalidInvitationRequest();
  }
  if (input.reason === undefined) return {};
  if (typeof input.reason !== 'string') throw invalidInvitationRequest();
  const reason = input.reason.trim().replace(/\s+/gu, ' ');
  if (reason.length < 1 || reason.length > 500 || unsafeReasonPattern.test(reason)) {
    throw invalidInvitationRequest();
  }
  return { safeReason: reason };
}
