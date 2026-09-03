import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@dar-tech/config';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from '../app.module.js';
import { configureApiFoundation } from '../platform/configure-api-foundation.js';
import type {
  AuditEventView,
  AuditEventFilters,
  EventHistoryActor,
  SecurityEventView,
  SecurityEventFilters,
} from './event-history.contracts.js';

const organizationId = '018f53d4-2f68-7c52-a399-3df2364d8701';
const auditId = '018f53d4-2f68-7c52-a399-3df2364d8702';
const securityId = '018f53d4-2f68-7c52-a399-3df2364d8703';
const actor: EventHistoryActor = {
  organizationId,
  employeeId: '018f53d4-2f68-7c52-a399-3df2364d8704',
  userAccountId: '018f53d4-2f68-7c52-a399-3df2364d8705',
};
const occurredAt = new Date('2026-09-02T09:00:00.000Z');

const audit: AuditEventView = {
  id: auditId,
  organizationId,
  actionKey: 'admin.employee.update',
  actorEmployeeId: actor.employeeId,
  actorSnapshot: {
    type: 'employee',
    displayName: 'Historical Actor',
    employeeCode: 'A-1',
  },
  targetType: 'employee',
  targetId: '018f53d4-2f68-7c52-a399-3df2364d8706',
  targetSnapshot: { displayName: 'Historical Target', employeeCode: 'A-2' },
  requestId: 'request-audit',
  correlationId: 'correlation-audit',
  sessionReference: null,
  safeReason: null,
  changeDelta: { changedFields: ['displayName'] },
  approvalReference: null,
  occurredAt,
  createdAt: occurredAt,
  eventVersion: 1,
  integrityVersion: 1,
};

const security: SecurityEventView = {
  id: securityId,
  organizationId,
  eventType: 'AuthenticationSucceeded.v1',
  category: 'authentication',
  risk: 'LOW',
  outcome: 'succeeded',
  actorEmployeeId: actor.employeeId,
  actorAccountId: actor.userAccountId,
  providerKey: 'local',
  sessionReference: null,
  actorSnapshot: {
    type: 'employee',
    displayName: 'Historical Actor',
    employeeCode: 'A-1',
  },
  safeContext: { assuranceLevel: 'local-development' },
  requestId: 'request-security',
  correlationId: 'correlation-security',
  occurredAt,
  createdAt: occurredAt,
  eventVersion: 1,
};

const config: ApiConfig = {
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

describe('event history read API', () => {
  let app: INestApplication;
  const auditListCalls: Array<[string, AuditEventFilters, number, number]> = [];
  const securityListCalls: Array<[string, SecurityEventFilters, number, number]> = [];
  const auditList = (
    scopedOrganizationId: string,
    filters: AuditEventFilters,
    page: number,
    pageSize: number,
  ) => {
    auditListCalls.push([scopedOrganizationId, filters, page, pageSize]);
    return Promise.resolve({ items: [audit], page: 1, pageSize: 10, total: 1 });
  };
  const securityList = (
    scopedOrganizationId: string,
    filters: SecurityEventFilters,
    page: number,
    pageSize: number,
  ) => {
    securityListCalls.push([scopedOrganizationId, filters, page, pageSize]);
    return Promise.resolve({
      items: [security],
      page: 1,
      pageSize: 10,
      total: 1,
    });
  };

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
      AppModule.register(
        config,
        { contextStore, logger },
        {
          eventHistoryTestAdapters: {
            actors: { currentActor: () => Promise.resolve(actor) },
            authorization: { authorize: () => Promise.resolve(true) },
            auditReader: {
              list: auditList,
              findById: (_organizationId, id) => Promise.resolve(id === auditId ? audit : null),
            },
            securityReader: {
              list: securityList,
              findById: (_organizationId, id) =>
                Promise.resolve(id === securityId ? security : null),
            },
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

  it('returns paginated safe audit and security views through bounded filters', async () => {
    const auditResponse = await request(app.getHttpServer())
      .get('/api/v1/audit-events?pageSize=10&actionKey=admin.employee.update')
      .expect(200);
    expect(auditResponse.body).toMatchObject({
      data: { total: 1, items: [{ id: auditId }] },
    });
    expect(auditListCalls).toContainEqual([
      organizationId,
      { actionKey: 'admin.employee.update' },
      1,
      10,
    ]);

    const securityResponse = await request(app.getHttpServer())
      .get('/api/v1/security-events?pageSize=10&risk=LOW')
      .expect(200);
    expect(securityResponse.body.data).toMatchObject({
      total: 1,
      items: [
        {
          id: securityId,
          safeContext: { assuranceLevel: 'local-development' },
        },
      ],
    });
    expect(JSON.stringify(securityResponse.body)).not.toMatch(
      /password|secret|token|nonce|authorizationCode|providerSubject|stack/iu,
    );
  });

  it('uses safe not-found behavior and rejects unbounded filters', async () => {
    const missing = '018f53d4-2f68-7c52-a399-3df2364d87ff';
    const response = await request(app.getHttpServer())
      .get(`/api/v1/audit-events/${missing}`)
      .expect(404);
    expect(response.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found',
      requestId: response.headers['x-request-id'],
    });
    await request(app.getHttpServer()).get('/api/v1/security-events?pageSize=101').expect(400);
  });

  it('documents exactly four GET-only history endpoints with safe schemas', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/openapi.json').expect(200);
    const document = response.body.data ?? response.body;
    for (const path of [
      '/api/v1/audit-events',
      '/api/v1/audit-events/{id}',
      '/api/v1/security-events',
      '/api/v1/security-events/{id}',
    ]) {
      expect(document.paths[path].get).toBeTruthy();
      expect(document.paths[path].patch).toBeUndefined();
      expect(document.paths[path].delete).toBeUndefined();
    }
    expect(JSON.stringify(document)).not.toMatch(
      /passwordHash|accessToken|refreshToken|authorizationCode|providerSubject|rawProvider/iu,
    );
  });
});
