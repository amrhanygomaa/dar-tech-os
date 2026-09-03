import type { Request, Response } from 'express';
import type { SessionConfig } from '@dar-tech/config';
import {
  SESSION_COOKIE_NAME,
  type SessionCookieInstruction,
} from './session.contracts.js';
import { isCanonicalSessionCredential } from './session-secret.js';

export type ParsedSessionCookie =
  | { readonly status: 'missing' }
  | { readonly status: 'invalid' }
  | { readonly status: 'present'; readonly credential: string };

export function parseSessionCookie(request: Pick<Request, 'headers'>): ParsedSessionCookie {
  const header = request.headers.cookie;
  if (header === undefined) return { status: 'missing' };
  if (typeof header !== 'string' || header.length === 0 || header.length > 8_192) {
    return { status: 'invalid' };
  }
  const values: string[] = [];
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      values.push(part.slice(separator + 1).trim());
    }
  }
  if (values.length === 0) return { status: 'missing' };
  if (values.length !== 1 || !isCanonicalSessionCredential(values[0]!)) {
    return { status: 'invalid' };
  }
  return { status: 'present', credential: values[0]! };
}

function cookieAttributes(config: SessionConfig): string[] {
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(config.secureCookie ? ['Secure'] : []),
  ];
}

export function applySessionCookie(
  response: Pick<Response, 'append'>,
  instruction: SessionCookieInstruction,
  config: SessionConfig,
  now: Date,
): void {
  if (instruction.kind === 'clear') {
    response.append(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; ${[
        ...cookieAttributes(config),
        'Max-Age=0',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ].join('; ')}`,
    );
    return;
  }
  if (!instruction.credential || !instruction.absoluteExpiresAt) {
    throw new TypeError('Set-cookie instruction is incomplete');
  }
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((instruction.absoluteExpiresAt.getTime() - now.getTime()) / 1_000),
  );
  response.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${instruction.credential}; ${[
      ...cookieAttributes(config),
      `Max-Age=${maxAgeSeconds}`,
      `Expires=${instruction.absoluteExpiresAt.toUTCString()}`,
    ].join('; ')}`,
  );
}

export function hasValidCsrfOrigin(
  request: Pick<Request, 'method' | 'headers'>,
  allowedOrigins: readonly string[],
): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.origin;
  return typeof origin === 'string' && allowedOrigins.includes(origin);
}
