import { describe, expect, it, vi } from 'vitest';
import type {
  AuditEventReadRepositoryPort,
  EventHistoryActor,
  EventHistoryActorPort,
  EventHistoryAuthorizationPort,
  SecurityEventReadRepositoryPort,
} from './event-history.contracts.js';
import {
  parseAuditEventQuery,
  parseSecurityEventQuery,
  validateSecurityEventAppend,
} from './event-history-input.js';
import { EventHistoryModule } from './event-history.module.js';
import { EventHistoryService } from './event-history.service.js';
import {
  PrismaAuditEventRepository,
  PrismaSecurityEventRepository,
} from './prisma-event-history.repository.js';

const actor: EventHistoryActor = {
  organizationId: '018f53d4-2f68-7c52-a399-3df2364d86a1',
  employeeId: '018f53d4-2f68-7c52-a399-3df2364d86a2',
  userAccountId: '018f53d4-2f68-7c52-a399-3df2364d86a3',
};

function harness(options: { actor?: EventHistoryActor | null; allowed?: boolean } = {}) {
  const actors: EventHistoryActorPort = {
    currentActor: vi.fn().mockResolvedValue(options.actor === undefined ? actor : options.actor),
  };
  const authorization: EventHistoryAuthorizationPort = {
    authorize: vi.fn().mockResolvedValue(options.allowed ?? true),
  };
  const audit: AuditEventReadRepositoryPort = {
    list: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 }),
    findById: vi.fn().mockResolvedValue(null),
  };
  const security: SecurityEventReadRepositoryPort = {
    list: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 }),
    findById: vi.fn().mockResolvedValue(null),
  };
  return {
    actors,
    authorization,
    audit,
    security,
    service: new EventHistoryService(actors, authorization, audit, security),
  };
}

describe('event history read and append boundaries', () => {
  it('fails closed without a trusted actor or an explicit allow decision', async () => {
    const unauthenticated = harness({ actor: null });
    await expect(unauthenticated.service.listAuditEvents({}, 1, 50)).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });
    expect(unauthenticated.authorization.authorize).not.toHaveBeenCalled();

    const denied = harness({ allowed: false });
    await expect(denied.service.listSecurityEvents({}, 1, 50)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
      statusCode: 403,
    });
    expect(denied.security.list).not.toHaveBeenCalled();
  });

  it('derives organization scope and permission keys only from the trusted actor', async () => {
    const { service, audit, security, authorization } = harness();
    await service.listAuditEvents({ actionKey: 'admin.employee.update' }, 2, 25);
    await service.listSecurityEvents({ risk: 'HIGH' }, 1, 10);

    expect(audit.list).toHaveBeenCalledWith(
      actor.organizationId,
      { actionKey: 'admin.employee.update' },
      2,
      25,
    );
    expect(security.list).toHaveBeenCalledWith(actor.organizationId, { risk: 'HIGH' }, 1, 10);
    expect(authorization.authorize).toHaveBeenNthCalledWith(1, {
      actor,
      action: 'audit.event.read',
      resource: { type: 'audit-event', organizationId: actor.organizationId },
    });
    expect(authorization.authorize).toHaveBeenNthCalledWith(2, {
      actor,
      action: 'security.event.read',
      resource: {
        type: 'security-event',
        organizationId: actor.organizationId,
      },
    });
  });

  it('returns the same safe not-found result for absent and cross-organization identifiers', async () => {
    const { service } = harness();
    await expect(
      service.getAuditEvent('018f53d4-2f68-7c52-a399-3df2364d86ff'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    await expect(
      service.getSecurityEvent('018f53d4-2f68-7c52-a399-3df2364d86fe'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  it('accepts only bounded explicit filters and a maximum page size of 100', () => {
    expect(
      parseAuditEventQuery({
        page: '2',
        pageSize: '100',
        actionKey: 'admin.employee.update',
        occurredFrom: '2026-09-01T00:00:00.000Z',
        occurredTo: '2026-09-02T00:00:00.000Z',
      }),
    ).toMatchObject({ page: 2, pageSize: 100 });
    expect(() => parseAuditEventQuery({ pageSize: '101' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() => parseSecurityEventQuery({ risk: 'EXTREME' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
    expect(() =>
      parseSecurityEventQuery({
        occurredFrom: '2026-09-03T00:00:00.000Z',
        occurredTo: '2026-09-02T00:00:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('rejects sensitive or identity-enumerating security context', () => {
    const base = {
      eventType: 'AuthenticationFailed.v1' as const,
      category: 'authentication',
      risk: 'MEDIUM' as const,
      outcome: 'failed',
      providerKey: 'local',
      correlationId: 'correlation-1',
    };
    expect(() =>
      validateSecurityEventAppend({
        ...base,
        safeContext: { authorizationCode: 'must-not-persist' },
      }),
    ).toThrow('Unsafe event history input');
    expect(() =>
      validateSecurityEventAppend({
        ...base,
        safeContext: { providerSubject: 'must-not-persist' },
      }),
    ).toThrow('Unsafe event history input');
    expect(() =>
      validateSecurityEventAppend({
        ...base,
        actorEmployeeId: actor.employeeId,
      }),
    ).toThrow('Unsafe event history input');
  });

  it('exposes append/read only and forbids test adapters outside test', () => {
    for (const repository of [PrismaAuditEventRepository, PrismaSecurityEventRepository]) {
      const methods = Object.getOwnPropertyNames(repository.prototype);
      expect(methods).toEqual(expect.arrayContaining(['append', 'list', 'findById']));
      expect(methods).not.toEqual(expect.arrayContaining(['update', 'delete', 'remove']));
    }
    expect(() =>
      EventHistoryModule.register('production', {
        actors: { currentActor: () => Promise.resolve(actor) },
      }),
    ).toThrow('Event history test adapters are available only in the test environment');
  });
});
