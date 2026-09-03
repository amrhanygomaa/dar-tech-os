import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from './app.module.js';
import { configureApiFoundation } from './platform/configure-api-foundation.js';

const testConfig: ApiConfig = {
  runtime: 'api',
  appEnvironment: 'test',
  nodeEnvironment: 'test',
  logLevel: 'fatal',
  port: 3001,
  databaseUrl: 'postgresql://test:test@127.0.0.1:5432/dartech_test?schema=public',
  databasePoolMax: 1,
  databaseConnectTimeoutMs: 100,
  databaseIdleTimeoutMs: 100,
  authentication: {
    allowedRedirectUris: [],
    localProviderEnabled: false,
    localIdentities: [],
    transactionTtlSeconds: 300,
  },
  invitation: { ttlSeconds: 300, rateLimitMaxRequests: 30, rateLimitWindowSeconds: 60 },
  session: { idleTtlSeconds: 300, absoluteTtlSeconds: 3600, allowedOrigins: ['http://localhost:3000'], secureCookie: false },
};

describe('API foundation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'test',
      level: 'fatal',
      destination,
    });

    app = await NestFactory.create(
      AppModule.register(testConfig, { contextStore, logger }),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the versioned response contract and propagates caller correlation', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1')
      .set('X-Request-ID', 'request-123')
      .set('X-Correlation-ID', 'correlation-456')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('request-123');
    expect(response.headers['x-correlation-id']).toBe('correlation-456');
    expect(response.body).toEqual({
      data: { name: 'dar-tech-os', runtime: 'api', apiVersion: 'v1' },
      meta: { requestId: 'request-123' },
    });
  });

  it('returns a stable safe error contract', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/not-present')
      .expect(404);

    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        requestId: response.headers['x-request-id'],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('replaces an invalid inbound request identifier', async () => {
    const invalidIdentifier = `request-${'x'.repeat(130)}`;
    const response = await request(app.getHttpServer())
      .get('/api/v1')
      .set('X-Request-ID', invalidIdentifier)
      .expect(200);

    expect(response.headers['x-request-id']).not.toBe(invalidIdentifier);
    expect(response.body.meta.requestId).toBe(response.headers['x-request-id']);
  });

  it('assigns request IDs before malformed JSON is rejected', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);

    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body.error).toMatchObject({
      code: 'INVALID_REQUEST',
      requestId: response.headers['x-request-id'],
    });
  });

  it('exposes liveness outside the versioned API without querying PostgreSQL', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);

    expect(response.body).toEqual({
      data: { status: 'ok' },
      meta: { requestId: response.headers['x-request-id'] },
    });
  });

  it('reports degraded health and fails readiness when PostgreSQL is unavailable', async () => {
    const health = await request(app.getHttpServer()).get('/health').expect(200);
    const readiness = await request(app.getHttpServer()).get('/health/ready').expect(503);

    expect(health.body.data).toMatchObject({
      status: 'degraded',
      checks: { database: { status: 'down' } },
    });
    expect(readiness.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service is not ready',
      requestId: readiness.headers['x-request-id'],
    });
    await request(app.getHttpServer()).get('/api/v1/health').expect(404);
  });

  it.each([
    '/api/v1/me',
    '/api/v1/employees',
    '/api/v1/audit-events',
    '/api/v1/security-events',
  ])(
    'fails closed for identity route %s when no trusted actor exists',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path).expect(401);

      expect(response.body).toEqual({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Trusted authentication is required',
          requestId: response.headers['x-request-id'],
        },
      });
    },
  );

  it('publishes versioned OpenAPI identity contracts without lifecycle PATCH fields', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/openapi.json').expect(200);
    const document = response.body.data ?? response.body;

    expect(document.paths).toMatchObject({
      '/api/v1/me': { get: expect.any(Object), patch: expect.any(Object) },
      '/api/v1/employees': { get: expect.any(Object) },
      '/api/v1/employees/{id}': { get: expect.any(Object), patch: expect.any(Object) },
    });
    const employeePatch =
      document.paths['/api/v1/employees/{id}'].patch.requestBody.content['application/json'].schema;
    expect(employeePatch.properties).toEqual({
      firstName: expect.any(Object),
      lastName: expect.any(Object),
      displayName: expect.any(Object),
      workEmail: expect.any(Object),
    });
    expect(employeePatch.properties).not.toHaveProperty('lifecycleStatus');
    expect(employeePatch.additionalProperties).toBe(false);
    expect(Object.keys(document.paths).some((path) => /\/customers?(?:\/|$)/u.test(path))).toBe(
      false,
    );
    expect(document.paths).toMatchObject({
      '/api/v1/auth/providers': { get: expect.any(Object) },
      '/api/v1/auth/{providerKey}/start': { post: expect.any(Object) },
      '/api/v1/auth/{providerKey}/callback': { post: expect.any(Object) },
      '/api/v1/auth/{providerKey}/provider-logout': { post: expect.any(Object) },
    });
    expect(document.paths['/api/v1/employees/{id}']).not.toHaveProperty('delete');
    expect(document.paths).toMatchObject({
      '/api/v1/audit-events': { get: expect.any(Object) },
      '/api/v1/audit-events/{id}': { get: expect.any(Object) },
      '/api/v1/security-events': { get: expect.any(Object) },
      '/api/v1/security-events/{id}': { get: expect.any(Object) },
    });
    for (const path of [
      '/api/v1/audit-events',
      '/api/v1/audit-events/{id}',
      '/api/v1/security-events',
      '/api/v1/security-events/{id}',
    ]) {
      expect(document.paths[path]).not.toHaveProperty('patch');
      expect(document.paths[path]).not.toHaveProperty('delete');
    }
    expect(JSON.stringify(document)).not.toMatch(/passwordHash|password login|providerSecret/iu);
    expect(JSON.stringify(document)).not.toMatch(
      /example[^}]+(?:authorizationCode|clientSecret|refreshToken|accessToken|nonce|state)/iu,
    );
  });
});
