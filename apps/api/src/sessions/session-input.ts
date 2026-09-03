import { invalidSessionRequest } from './session.errors.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseSessionId(value: string): string {
  if (!uuidPattern.test(value)) throw invalidSessionRequest();
  return value.toLowerCase();
}

export function parseRevokeAllBody(input: unknown): { readonly includeCurrent: boolean } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidSessionRequest();
  const entries = Object.entries(input);
  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== 'includeCurrent' ||
    typeof entries[0][1] !== 'boolean'
  ) {
    throw invalidSessionRequest();
  }
  return { includeCurrent: entries[0][1] };
}

export function parseSessionPagination(
  pageInput?: string,
  pageSizeInput?: string,
): { readonly page: number; readonly pageSize: number } {
  const page = pageInput === undefined ? 1 : Number(pageInput);
  const pageSize = pageSizeInput === undefined ? 25 : Number(pageSizeInput);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw invalidSessionRequest();
  }
  return { page, pageSize };
}
