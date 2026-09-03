import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { SessionConfig } from '@dar-tech/config';
import { applySessionCookie, hasValidCsrfOrigin, parseSessionCookie } from './session-cookie.js';
import { CryptographicSessionCredentialGenerator } from './session-secret.js';

const developmentConfig: SessionConfig = {
  idleTtlSeconds: 300,
  absoluteTtlSeconds: 3600,
  allowedOrigins: ['http://localhost:3000'],
  secureCookie: false,
};

describe('S02-T04 session credential and browser boundary', () => {
  it('includes the credential generator source in the hardened Docker build context', () => {
    const dockerIgnore = readFileSync(
      fileURLToPath(new URL('../../../../.dockerignore', import.meta.url)),
      'utf8',
    );
    expect(dockerIgnore).toContain('!apps/api/src/sessions/session-secret.ts');
  });

  it('creates unique 256-bit credentials and persists only deterministic SHA-256 digests', () => {
    const generator = new CryptographicSessionCredentialGenerator();
    const materials = Array.from({ length: 128 }, () => generator.generate());
    expect(new Set(materials.map(({ credential }) => credential))).toHaveLength(128);
    for (const material of materials) {
      expect(material.credential).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(Buffer.from(material.credential, 'base64url')).toHaveLength(32);
      expect(material.hash).toBe(
        createHash('sha256').update(material.credential, 'utf8').digest('hex'),
      );
      expect(material.hash).not.toContain(material.credential);
    }
  });

  it.each([
    '',
    'dartech_session=',
    'dartech_session=short',
    `dartech_session=${'A'.repeat(42)}`,
    `dartech_session=${'A'.repeat(43)}; dartech_session=${'B'.repeat(43)}`,
    `unknown=${'x'.repeat(8_200)}`,
  ])('rejects malformed, duplicate, empty, or oversized cookie input generically', (cookie) => {
    expect(parseSessionCookie({ headers: { cookie } } as Pick<Request, 'headers'>).status).toBe(
      'invalid',
    );
  });

  it('accepts one canonical credential and ignores unrelated cookies', () => {
    const credential = new CryptographicSessionCredentialGenerator().generate().credential;
    expect(
      parseSessionCookie({
        headers: { cookie: `theme=light; dartech_session=${credential}` },
      } as Pick<Request, 'headers'>),
    ).toEqual({ status: 'present', credential });
  });

  it('serializes host-only HttpOnly Lax cookies and secure deployment clearing consistently', () => {
    const append = vi.fn();
    const response = { append } as unknown as Pick<Response, 'append'>;
    const now = new Date('2026-09-03T10:00:00.000Z');
    const expiresAt = new Date('2026-09-03T11:00:00.000Z');
    const credential = new CryptographicSessionCredentialGenerator().generate().credential;
    applySessionCookie(
      response,
      { kind: 'set', credential, absoluteExpiresAt: expiresAt },
      { ...developmentConfig, secureCookie: true },
      now,
    );
    applySessionCookie(
      response,
      { kind: 'clear' },
      { ...developmentConfig, secureCookie: true },
      now,
    );
    const serialized = append.mock.calls.flat().join('\n');
    expect(serialized).toContain('Path=/; HttpOnly; SameSite=Lax; Secure');
    expect(serialized).toContain('Max-Age=3600');
    expect(serialized).toContain('Max-Age=0');
    expect(serialized).not.toMatch(/Domain=/iu);
  });

  it('requires an exact configured Origin only for unsafe cookie-authenticated requests', () => {
    expect(
      hasValidCsrfOrigin(
        { method: 'GET', headers: {} } as Pick<Request, 'method' | 'headers'>,
        developmentConfig.allowedOrigins,
      ),
    ).toBe(true);
    expect(
      hasValidCsrfOrigin(
        { method: 'POST', headers: {} } as Pick<Request, 'method' | 'headers'>,
        developmentConfig.allowedOrigins,
      ),
    ).toBe(false);
    expect(
      hasValidCsrfOrigin(
        { method: 'POST', headers: { origin: 'http://localhost:3000' } } as Pick<
          Request,
          'method' | 'headers'
        >,
        developmentConfig.allowedOrigins,
      ),
    ).toBe(true);
    expect(
      hasValidCsrfOrigin(
        { method: 'POST', headers: { origin: 'http://localhost:3000.evil.invalid' } } as Pick<
          Request,
          'method' | 'headers'
        >,
        developmentConfig.allowedOrigins,
      ),
    ).toBe(false);
  });
});
