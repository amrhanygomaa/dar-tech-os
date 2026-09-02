import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from '../app.module.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';

const config: ApiConfig = {
  runtime: 'api',
  appEnvironment: 'production',
  nodeEnvironment: 'production',
  logLevel: 'error',
  port: 3001,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused?schema=public',
  databasePoolMax: 1,
  databaseConnectTimeoutMs: 50,
  databaseIdleTimeoutMs: 50,
  authentication: {
    allowedRedirectUris: ['https://portal.example.test/onboarding/callback/provider'],
    localProviderEnabled: false,
    localIdentities: [],
    transactionTtlSeconds: 300,
  },
  invitation: { ttlSeconds: 300, rateLimitMaxRequests: 30, rateLimitWindowSeconds: 60 },
};

describe('S02-T05 default production authorization boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const destination = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'production',
      level: 'error',
      destination,
    });
    app = await NestFactory.create(AppModule.register(config, { contextStore, logger }), { logger });
    configureApiFoundation(app, contextStore, logger);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('fails closed before database access and ignores role-like request assertions', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/roles?actor=founder')
      .set('X-Role', 'Super Admin')
      .set('X-Employee-Email', 'founder@example.com')
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
