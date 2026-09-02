import { immutableRoleKey, invalidRoleInput, invalidRoleRequest } from './role.errors.js';
import type { CreateRoleInput, UpdateRoleInput } from './role.contracts.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const roleKeyPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidRoleInput();
  return input as Record<string, unknown>;
}

function assertKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw invalidRoleInput();
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || controlCharacterPattern.test(value)) throw invalidRoleInput();
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0 || normalized.length > maximum) throw invalidRoleInput();
  return normalized;
}

export function normalizeRoleKey(value: unknown): string {
  if (typeof value !== 'string' || controlCharacterPattern.test(value)) throw invalidRoleInput();
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 64 || !roleKeyPattern.test(normalized)) {
    throw invalidRoleInput();
  }
  return normalized;
}

export function normalizeRoleName(value: unknown): { name: string; normalizedName: string } {
  const name = text(value, 160);
  return { name, normalizedName: name.toLowerCase() };
}

function description(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || controlCharacterPattern.test(value)) throw invalidRoleInput();
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length > 500) throw invalidRoleInput();
  return normalized.length === 0 ? null : normalized;
}

export function parseCreateRole(input: unknown): CreateRoleInput {
  const body = objectInput(input);
  assertKeys(body, ['key', 'name', 'description']);
  if (body.key === undefined || body.name === undefined) throw invalidRoleInput();
  return {
    key: normalizeRoleKey(body.key),
    ...normalizeRoleName(body.name),
    description: description(body.description),
  };
}

export function parseUpdateRole(input: unknown): UpdateRoleInput {
  const body = objectInput(input);
  if ('key' in body || 'roleKey' in body) throw immutableRoleKey();
  assertKeys(body, ['name', 'description']);
  if (Object.keys(body).length === 0) throw invalidRoleInput();
  const normalizedName = body.name === undefined ? undefined : normalizeRoleName(body.name);
  return {
    ...(normalizedName ?? {}),
    ...('description' in body ? { description: description(body.description) } : {}),
  };
}

export function parseRoleId(value: string): string {
  if (!uuidPattern.test(value)) throw invalidRoleRequest();
  return value.toLowerCase();
}

export function parseRolePagination(pageInput?: string, pageSizeInput?: string) {
  const parse = (value: string | undefined, fallback: number, maximum: number): number => {
    if (value === undefined) return fallback;
    if (!/^\d+$/u.test(value)) throw invalidRoleRequest();
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw invalidRoleRequest();
    return number;
  };
  return { page: parse(pageInput, 1, 1_000_000), pageSize: parse(pageSizeInput, 50, 100) };
}

export function parseAssignment(input: unknown): { roleId: string; expiresAt: Date | null } {
  const body = objectInput(input);
  assertKeys(body, ['roleId', 'expiresAt']);
  if (typeof body.roleId !== 'string') throw invalidRoleInput();
  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== 'string' || body.expiresAt.length > 40) throw invalidRoleInput();
    expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) throw invalidRoleInput();
  }
  return { roleId: parseRoleId(body.roleId), expiresAt };
}
