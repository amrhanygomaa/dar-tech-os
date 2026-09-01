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
});
