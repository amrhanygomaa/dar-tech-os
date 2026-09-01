import type { EmployeeProfilePatch } from './identity.contracts.js';
import {
  invalidIdentityRequest,
  invalidIdentityUpdate,
  lifecycleMutationNotAllowed,
} from './identity.errors.js';

const allowedProfileFields = new Set(['firstName', 'lastName', 'displayName', 'workEmail']);
const selfProfileFields = new Set(['displayName']);
const lifecycleFields = new Set([
  'status',
  'lifecycleStatus',
  'lifecycle_status',
  'invitedAt',
  'invited_at',
  'activatedAt',
  'activated_at',
  'suspendedAt',
  'suspended_at',
  'offboardingAt',
  'offboarding_at',
  'archivedAt',
  'archived_at',
  'authenticationEligible',
  'authentication_eligible',
  'disabledAt',
  'disabled_at',
]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function normalizedName(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') throw invalidIdentityUpdate();
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length < 1 || normalized.length > maximumLength) {
    throw invalidIdentityUpdate();
  }
  return normalized;
}

export function normalizeWorkEmail(value: unknown): string {
  if (typeof value !== 'string') throw invalidIdentityUpdate();
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !emailPattern.test(normalized)) {
    throw invalidIdentityUpdate();
  }
  return normalized;
}

export function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeProviderSubject(value: string): string {
  return value.trim();
}

export function parseEmployeeProfilePatch(
  input: unknown,
  scope: 'self' | 'admin',
): EmployeeProfilePatch {
  if (!isPlainRecord(input)) throw invalidIdentityUpdate();
  const keys = Object.keys(input);
  if (keys.length === 0) throw invalidIdentityUpdate();
  if (keys.some((key) => lifecycleFields.has(key))) throw lifecycleMutationNotAllowed();

  const permitted = scope === 'self' ? selfProfileFields : allowedProfileFields;
  if (keys.some((key) => !permitted.has(key))) throw invalidIdentityUpdate();

  const patch: {
    firstName?: string;
    lastName?: string;
    displayName?: string;
    workEmail?: string;
  } = {};
  if ('firstName' in input) patch.firstName = normalizedName(input.firstName, 100);
  if ('lastName' in input) patch.lastName = normalizedName(input.lastName, 100);
  if ('displayName' in input) patch.displayName = normalizedName(input.displayName, 160);
  if ('workEmail' in input) patch.workEmail = normalizeWorkEmail(input.workEmail);
  return patch;
}

export function parsePagination(
  pageInput: string | undefined,
  pageSizeInput: string | undefined,
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
    throw invalidIdentityRequest();
  }
  return { page, pageSize };
}

export function parseIdentityId(value: string): string {
  if (!uuidPattern.test(value)) throw invalidIdentityRequest();
  return value.toLowerCase();
}
