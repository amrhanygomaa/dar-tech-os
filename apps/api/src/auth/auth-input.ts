import { invalidAuthenticationRequest } from './auth.errors.js';

const providerKeyPattern = /^[a-z][a-z0-9._-]{0,63}$/u;
const transactionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(input).every((key) => allowed.has(key));
}

function boundedString(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw invalidAuthenticationRequest();
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw invalidAuthenticationRequest();
  }
  return normalized;
}

function absoluteHttpUrl(value: unknown): string {
  const candidate = boundedString(value, 1, 2_048);
  try {
    const parsed = new URL(candidate);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.hash.length > 0
    ) {
      throw new Error('unsafe URL');
    }
    return parsed.href;
  } catch {
    throw invalidAuthenticationRequest();
  }
}

export function parseProviderKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!providerKeyPattern.test(normalized)) throw invalidAuthenticationRequest();
  return normalized;
}

export function parseAuthenticationStart(input: unknown): {
  readonly redirectUri: string;
  readonly loginHint?: string;
} {
  if (!isPlainRecord(input) || !hasOnlyKeys(input, new Set(['redirectUri', 'loginHint']))) {
    throw invalidAuthenticationRequest();
  }
  const redirectUri = absoluteHttpUrl(input.redirectUri);
  const loginHint = input.loginHint === undefined ? undefined : boundedString(input.loginHint, 1, 160);
  return { redirectUri, ...(loginHint ? { loginHint } : {}) };
}

export function parseAuthenticationCallback(input: unknown): {
  readonly transactionId: string;
  readonly state: string;
  readonly nonce?: string;
  readonly authorizationCode?: string;
  readonly providerError?: string;
} {
  const keys = new Set(['transactionId', 'state', 'nonce', 'code', 'error']);
  if (!isPlainRecord(input) || !hasOnlyKeys(input, keys)) throw invalidAuthenticationRequest();
  const transactionId = boundedString(input.transactionId, 1, 64).toLowerCase();
  if (!transactionIdPattern.test(transactionId)) throw invalidAuthenticationRequest();
  const state = boundedString(input.state, 16, 512);
  const nonce = input.nonce === undefined ? undefined : boundedString(input.nonce, 16, 512);
  const authorizationCode =
    input.code === undefined ? undefined : boundedString(input.code, 1, 4_096);
  const providerError =
    input.error === undefined ? undefined : boundedString(input.error, 1, 128);
  if (!authorizationCode && !providerError) throw invalidAuthenticationRequest();
  return {
    transactionId,
    state,
    ...(nonce ? { nonce } : {}),
    ...(authorizationCode ? { authorizationCode } : {}),
    ...(providerError ? { providerError } : {}),
  };
}

export function parseProviderLogout(input: unknown): {
  readonly postLogoutRedirectUri: string | null;
} {
  if (!isPlainRecord(input) || !hasOnlyKeys(input, new Set(['postLogoutRedirectUri']))) {
    throw invalidAuthenticationRequest();
  }
  return {
    postLogoutRedirectUri:
      input.postLogoutRedirectUri === undefined
        ? null
        : absoluteHttpUrl(input.postLogoutRedirectUri),
  };
}
