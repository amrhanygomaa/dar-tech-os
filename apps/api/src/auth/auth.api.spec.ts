import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import type { LinkedAuthenticationIdentity } from './auth.contracts.js';
import { AppModule } from '../app.module.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';

const redirectUri = 'http://localhost:3000/auth/callback';
const config: ApiConfig = {
  runtime: 'api',
  appEnvironment: 'test',
  nodeEnvironment: 'test',
  logLevel: 'info',
  port: 3001,
  databaseUrl: 'postgresql://test:test@127.0.0.1:5432/dartech_test?schema=public',
  databasePoolMax: 1,
  databaseConnectTimeoutMs: 100,
  databaseIdleTimeoutMs: 100,
  authentication: {
    allowedRedirectUris: [redirectUri],
    localProviderEnabled: true,
    localIdentities: [
      {
        loginHint: 'employee',
        providerSubject: 'local-api-subject',
        verifiedEmail: 'employee@example.com',
      },
    ],
    transactionTtlSeconds: 300,
  },
  invitation: { ttlSeconds: 300, rateLimitMaxRequests: 30, rateLimitWindowSeconds: 60 },
};

const linkedIdentity: LinkedAuthenticationIdentity = {
  ssoIdentityId: '018f53d4-2f68-7c52-a399-3df2364d8611',
  organizationId: '018f53d4-2f68-7c52-a399-3df2364d8612',
  userAccount: {
    id: '018f53d4-2f68-7c52-a399-3df2364d8613',
    organizationId: '018f53d4-2f68-7c52-a399-3df2364d8612',
    employeeId: '018f53d4-2f68-7c52-a399-3df2364d8614',
    authenticationEligible: true,
    disabledAt: null,
  },
  employee: {
    id: '018f53d4-2f68-7c52-a399-3df2364d8614',
    organizationId: '018f53d4-2f68-7c52-a399-3df2364d8612',
    lifecycleStatus: 'ACTIVE',
  },
};

describe('provider-neutral authentication API', () => {
  let app: INestApplication;
  let logOutput = '';

  beforeAll(async () => {
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logOutput += chunk.toString();
        callback();
      },
    });
    const contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'test',
      level: 'info',
      destination,
    });
    app = await NestFactory.create(
      AppModule.register(
        config,
        { contextStore, logger },
        {
          authenticationTestAdapters: {
            identities: { findLinkedIdentity: () => Promise.resolve(linkedIdentity) },
            invitations: { authorize: () => Promise.resolve(null) },
            security: { record: () => Promise.resolve() },
          },
        },
      ),
      { logger },
    );
    configureApiFoundation(app, contextStore, logger);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('discovers configured providers and completes a verified no-session callback', async () => {
    const providers = await request(app.getHttpServer())
      .get('/api/v1/auth/providers')
      .expect(200);
    expect(providers.body.data).toEqual([
      {
        key: 'local',
        displayName: 'Local development',
        iconKey: 'terminal',
        capabilities: { authentication: true, providerLogout: false },
      },
    ]);

    const started = await request(app.getHttpServer())
      .post('/api/v1/auth/local/start')
      .send({ redirectUri, loginHint: 'employee' })
      .expect(200);
    expect(started.body.data).toMatchObject({
      providerKey: 'local',
      interaction: 'redirect',
      sessionCreated: false,
    });
    const localRedirect = new URL(started.body.data.authorizationUrl as string);
    const callbackBody = {
      transactionId: localRedirect.searchParams.get('transactionId'),
      state: localRedirect.searchParams.get('state'),
      nonce: localRedirect.searchParams.get('nonce'),
      code: localRedirect.searchParams.get('code'),
    };
    const callback = await request(app.getHttpServer())
      .post('/api/v1/auth/local/callback')
      .send(callbackBody)
      .expect(200);
    expect(callback.body.data).toEqual({
      status: 'VERIFIED',
      providerKey: 'local',
      sessionCreated: false,
      nextStep: 'SESSION_ISSUANCE_DEFERRED',
    });
    expect(callback.headers['set-cookie']).toBeUndefined();
    expect(callback.headers.authorization).toBeUndefined();

    expect(logOutput).not.toContain(callbackBody.state);
    expect(logOutput).not.toContain(callbackBody.nonce);
    expect(logOutput).not.toContain(callbackBody.code);
    expect(logOutput).not.toContain('local-api-subject');
    expect(logOutput).not.toContain('employee@example.com');
  });

  it('does not treat headers or query parameters as a production authentication bypass', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/local/callback?subject=local-api-subject&email=employee@example.com')
      .set('X-User-ID', linkedIdentity.userAccount.id)
      .set('X-Provider-Subject', 'local-api-subject')
      .send({})
      .expect(400);
    expect(response.body.error).toEqual({
      code: 'INVALID_REQUEST',
      message: 'Request could not be processed',
      requestId: response.headers['x-request-id'],
    });
  });

  it('distinguishes provider logout from application-session revocation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/local/provider-logout')
      .send({})
      .expect(200);
    expect(response.body.data).toEqual({
      providerKey: 'local',
      providerLogoutSupported: false,
      logoutUrl: null,
      applicationSessionRevoked: false,
    });
  });

  it('documents the no-session boundary without secret-bearing examples', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/openapi.json').expect(200);
    const document = response.body.data ?? response.body;
    const callback = document.paths['/api/v1/auth/{providerKey}/callback'].post;
    const providerLogout =
      document.paths['/api/v1/auth/{providerKey}/provider-logout'].post;

    expect(callback.summary).toMatch(/no application session/iu);
    expect(providerLogout.summary).toMatch(/does not revoke a Dar Tech application session/iu);
    const serialized = JSON.stringify(document);
    expect(serialized).not.toMatch(/client_secret|access_token|refresh_token|id_token/iu);
    expect(serialized).not.toMatch(/"example"\s*:\s*"[^"]*(?:state|nonce|code|token)/iu);
  });
});
