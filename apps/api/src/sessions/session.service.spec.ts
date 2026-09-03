import { describe, expect, it, vi } from 'vitest';
import type { SessionConfig } from '@dar-tech/config';
import type {
  SessionAdministrationAuthorizationPort,
  SessionCredentialGenerator,
  SessionMetricsPort,
  SessionPrincipal,
  SessionRepositoryPort,
} from './session.contracts.js';
import { SessionService } from './session.service.js';

const now = new Date('2026-09-03T10:00:00.000Z');
const config: SessionConfig = {
  idleTtlSeconds: 300,
  absoluteTtlSeconds: 3600,
  allowedOrigins: ['http://localhost:3000'],
  secureCookie: false,
};
const principal: SessionPrincipal = {
  sessionId: '018f53d4-2f68-7c52-a399-3df2364d8611',
  organizationId: '018f53d4-2f68-7c52-a399-3df2364d8612',
  userAccountId: '018f53d4-2f68-7c52-a399-3df2364d8613',
  employeeId: '018f53d4-2f68-7c52-a399-3df2364d8614',
  clientKind: 'browser',
  assuranceLevel: 'mfa',
  authenticatedAt: now,
  issuedAt: now,
  lastSeenAt: now,
  idleExpiresAt: new Date(now.getTime() + 300_000),
  absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
};

function harness(input: {
  repository?: Partial<SessionRepositoryPort>;
  allows?: boolean;
} = {}) {
  const repository: SessionRepositoryPort = {
    issue: vi.fn().mockResolvedValue({ principal, rotatedSessionId: null }),
    resolve: vi.fn().mockResolvedValue({ status: 'active', principal }),
    listSelf: vi.fn().mockResolvedValue([]),
    revokeSelf: vi.fn().mockResolvedValue('revoked'),
    revokeAllSelf: vi.fn().mockResolvedValue({ revokedCount: 2, currentRevoked: false }),
    listAdministration: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 }),
    revokeAdministration: vi.fn().mockResolvedValue('revoked'),
    revokeAllForEmployee: vi.fn().mockResolvedValue({ revokedCount: 1, currentRevoked: false }),
    ...input.repository,
  };
  const credentials: SessionCredentialGenerator = {
    generate: () => ({ credential: 'A'.repeat(43), hash: 'b'.repeat(64) }),
    hash: () => 'c'.repeat(64),
  };
  const authorization: SessionAdministrationAuthorizationPort = {
    allows: vi.fn().mockResolvedValue(input.allows ?? false),
  };
  const metrics: SessionMetricsPort = { record: vi.fn() };
  return {
    repository,
    service: new SessionService(
      config,
      { now: () => now },
      credentials,
      repository,
      authorization,
      metrics,
    ),
  };
}

describe('S02-T04 session service', () => {
  it('issues bounded idle and absolute expiry without treating authentication time as step-up', async () => {
    const test = harness();
    await test.service.establish(
      {
        organizationId: principal.organizationId,
        employeeId: principal.employeeId,
        userAccountId: principal.userAccountId,
      },
      { assurance: { level: 'mfa', methods: ['otp'] }, authenticatedAt: new Date(0) },
      { status: 'invalid' },
    );
    expect(test.repository.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        issuedAt: now,
        idleExpiresAt: new Date(now.getTime() + 300_000),
        absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
        authenticatedAt: new Date(0),
        assuranceLevel: 'mfa',
      }),
    );
    expect(test.repository.issue).not.toHaveBeenCalledWith(
      expect.objectContaining({ incomingCredentialHash: expect.anything() }),
    );
  });

  it('hashes a canonical incoming credential for fixation-safe rotation', async () => {
    const test = harness();
    await test.service.establish(
      {
        organizationId: principal.organizationId,
        employeeId: principal.employeeId,
        userAccountId: principal.userAccountId,
      },
      { assurance: { level: null, methods: [] }, authenticatedAt: null },
      { status: 'present', credential: 'A'.repeat(43) },
    );
    expect(test.repository.issue).toHaveBeenCalledWith(
      expect.objectContaining({ incomingCredentialHash: 'c'.repeat(64) }),
    );
  });

  it.each([
    ['revoked', 'revoked'],
    ['idle_expired', 'idle_expired'],
    ['absolute_expired', 'absolute_expired'],
    ['ineligible', 'ineligible'],
    ['unknown', 'unknown'],
  ] as const)('fails closed for %s resolution', async (_label, reason) => {
    const test = harness({
      repository: { resolve: vi.fn().mockResolvedValue({ status: 'invalid', reason }) },
    });
    await expect(
      test.service.resolveCookie({ status: 'present', credential: 'A'.repeat(43) }),
    ).resolves.toEqual({ principal: null, cookie: { kind: 'clear' } });
  });

  it('requires includeCurrent explicitly and keeps administration fail closed', async () => {
    const test = harness();
    await expect(test.service.revokeAllSelf(principal, {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(test.service.listAdministration(principal)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('passes a bounded internal employee-wide revocation command without exposing lifecycle endpoints', async () => {
    const test = harness();
    await test.service.revokeAllForEmployee({
      organizationId: principal.organizationId,
      employeeId: principal.employeeId,
      now,
    });
    expect(test.repository.revokeAllForEmployee).toHaveBeenCalledWith({
      organizationId: principal.organizationId,
      employeeId: principal.employeeId,
      includeCurrent: true,
      reason: 'employee_lifecycle_revocation',
      now,
    });
  });
});
