import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from '../app.module.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import type {
  SessionCredentialGenerator,
  SessionPrincipal,
  SessionRepositoryPort,
} from './session.contracts.js';

const now = new Date('2026-09-03T10:00:00.000Z');
const credential = Buffer.alloc(32, 7).toString('base64url');
const credentialHash = createHash('sha256').update(credential).digest('hex');
const principal: SessionPrincipal = {
  sessionId: '018f53d4-2f68-7c52-a399-3df2364d8611',
  organizationId: '018f53d4-2f68-7c52-a399-3df2364d8612',
  userAccountId: '018f53d4-2f68-7c52-a399-3df2364d8613',
  employeeId: '018f53d4-2f68-7c52-a399-3df2364d8614',
  clientKind: 'browser',
  assuranceLevel: null,
  authenticatedAt: null,
  issuedAt: now,
  lastSeenAt: now,
  idleExpiresAt: new Date(now.getTime() + 300_000),
  absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
};
const config: ApiConfig = {
  runtime: 'api', appEnvironment: 'test', nodeEnvironment: 'test', logLevel: 'info', port: 3001,
  databaseUrl: 'postgresql://test:test@127.0.0.1:5432/dartech_test?schema=public',
  databasePoolMax: 1, databaseConnectTimeoutMs: 100, databaseIdleTimeoutMs: 100,
  authentication: { allowedRedirectUris: [], localProviderEnabled: false, localIdentities: [], transactionTtlSeconds: 300 },
  invitation: { ttlSeconds: 300, rateLimitMaxRequests: 30, rateLimitWindowSeconds: 60 },
  session: { idleTtlSeconds: 300, absoluteTtlSeconds: 3600, allowedOrigins: ['http://localhost:3000'], secureCookie: false },
};

describe('S02-T04 session API boundary', () => {
  let app: INestApplication;
  const revokeSelf = vi.fn().mockResolvedValue('revoked');

  beforeAll(async () => {
    const repository: SessionRepositoryPort = {
      issue: vi.fn(),
      resolve: ({ credentialHash: candidate }) => Promise.resolve(
        candidate === credentialHash ? { status: 'active', principal } : { status: 'invalid', reason: 'unknown' },
      ),
      listSelf: () => Promise.resolve([{
        id: principal.sessionId, current: true, clientKind: 'browser', assuranceLevel: null,
        authenticatedAt: null, issuedAt: now, lastSeenAt: now,
        idleExpiresAt: principal.idleExpiresAt, absoluteExpiresAt: principal.absoluteExpiresAt,
        revokedAt: null, status: 'ACTIVE',
      }]),
      revokeSelf,
      revokeAllSelf: () => Promise.resolve({ revokedCount: 0, currentRevoked: false }),
      listAdministration: (input) => Promise.resolve({ items: [], page: input.page, pageSize: input.pageSize, total: 0 }),
      revokeAdministration: () => Promise.resolve('not_found'),
      revokeAllForEmployee: () => Promise.resolve(null),
    };
    const credentials: SessionCredentialGenerator = {
      generate: () => ({ credential, hash: credentialHash }),
      hash: (value) => createHash('sha256').update(value).digest('hex'),
    };
    const contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api', environment: 'test', level: 'info',
      destination: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    });
    app = await NestFactory.create(
      AppModule.register(config, { contextStore, logger }, {
        sessionTestAdapters: { repository, credentials, clock: { now: () => now } },
        authorizationTestAdapters: {
          clock: { now: () => now },
          grants: {
            listEffectivePermissionGrantsForEmployee: () => Promise.resolve([
              {
                permissionKey: 'identity.session.read_self',
                riskClassification: 'LOW',
                scopeType: 'SELF',
                scopeBindingType: null,
                scopeBindingId: null,
              },
              {
                permissionKey: 'identity.session.revoke_self',
                riskClassification: 'MEDIUM',
                scopeType: 'SELF',
                scopeBindingType: null,
                scopeBindingId: null,
              },
            ]),
          },
        },
      }),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger, config.session.allowedOrigins);
    await app.init();
  });

  afterAll(async () => app.close());

  it('lists only safe self-session metadata and never returns the credential or digest', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me/sessions')
      .set('Cookie', `dartech_session=${credential}`)
      .expect(200);
    expect(response.body.data[0]).toMatchObject({ id: principal.sessionId, current: true, status: 'ACTIVE' });
    expect(JSON.stringify(response.body)).not.toContain(credential);
    expect(JSON.stringify(response.body)).not.toContain(credentialHash);
  });

  it('denies missing and foreign Origin before unsafe cookie-authenticated mutation', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/me/sessions/${principal.sessionId}/revoke`)
      .set('Cookie', `dartech_session=${credential}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/me/sessions/${principal.sessionId}/revoke`)
      .set('Cookie', `dartech_session=${credential}`)
      .set('Origin', 'http://localhost:3000.evil.invalid')
      .send({})
      .expect(403);
    expect(revokeSelf).not.toHaveBeenCalled();
  });

  it('accepts an exact Origin and clears the matching cookie when current is revoked', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/me/sessions/${principal.sessionId}/revoke`)
      .set('Cookie', `dartech_session=${credential}`)
      .set('Origin', 'http://localhost:3000')
      .send({})
      .expect(200);
    expect(response.body.data.currentSessionRevoked).toBe(true);
    expect(response.headers['set-cookie']?.[0]).toContain('Max-Age=0');
  });

  it('returns one generic unauthenticated response and clears malformed cookies safely', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/me/sessions')
      .set('Cookie', 'dartech_session=malformed')
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(response.headers['set-cookie']?.[0]).toContain('Max-Age=0');
  });

  it('keeps session administration fail closed by default', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/sessions')
      .set('Cookie', `dartech_session=${credential}`)
      .expect(403);
  });

  it('documents all six session routes and no bearer, refresh, delete, or public inspection route', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/openapi.json').expect(200);
    const paths = Object.keys(response.body.data?.paths ?? response.body.paths);
    expect(paths).toEqual(expect.arrayContaining([
      '/api/v1/me/sessions',
      '/api/v1/me/sessions/{id}/revoke',
      '/api/v1/me/sessions/revoke-all',
      '/api/v1/admin/sessions',
      '/api/v1/admin/sessions/{id}/revoke',
      '/api/v1/employees/{id}/sessions/revoke-all',
    ]));
    const document = response.body.data ?? response.body;
    const sessionDocument = JSON.stringify(
      Object.fromEntries(
        Object.entries(document.paths).filter(([path]) => path.includes('/sessions')),
      ),
    );
    expect(sessionDocument).not.toMatch(/refresh.?token|delete session|credentialHash/iu);
    expect(document.components?.securitySchemes).not.toHaveProperty('bearer');
  });
});
