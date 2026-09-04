import { Inject, Injectable } from '@nestjs/common';
import type { SessionConfig } from '@dar-tech/config';
import type { NormalizedProviderIdentity } from '../auth/auth.contracts.js';
import {
  SESSION_ADMINISTRATION_ACTIONS,
  SESSION_ADMINISTRATION_AUTHORIZATION_PORT,
  SESSION_SELF_ACTIONS,
  SESSION_CLOCK,
  SESSION_CONFIG,
  SESSION_CREDENTIAL_GENERATOR,
  SESSION_METRICS_PORT,
  SESSION_REPOSITORY_PORT,
  type SessionAdministrationAuthorizationPort,
  type SessionClock,
  type SessionCookieInstruction,
  type SessionCredentialGenerator,
  type SessionMetricsPort,
  type SessionPage,
  type SessionPrincipal,
  type SessionRepositoryPort,
  type SessionView,
} from './session.contracts.js';
import type { ParsedSessionCookie } from './session-cookie.js';
import {
  sessionAuthenticationRequired,
  sessionAuthorizationDenied,
  sessionNotFound,
} from './session.errors.js';
import { parseRevokeAllBody, parseSessionId, parseSessionPagination } from './session-input.js';

export interface SessionEstablishmentPrincipal {
  readonly organizationId: string;
  readonly userAccountId: string;
  readonly employeeId: string;
}

export interface EstablishedSession {
  readonly principal: SessionPrincipal;
  readonly cookie: SessionCookieInstruction;
}

export interface CookieResolution {
  readonly principal: SessionPrincipal | null;
  readonly cookie: SessionCookieInstruction | null;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_CONFIG) readonly config: SessionConfig,
    @Inject(SESSION_CLOCK) private readonly clock: SessionClock,
    @Inject(SESSION_CREDENTIAL_GENERATOR)
    private readonly credentials: SessionCredentialGenerator,
    @Inject(SESSION_REPOSITORY_PORT) private readonly repository: SessionRepositoryPort,
    @Inject(SESSION_ADMINISTRATION_AUTHORIZATION_PORT)
    private readonly administrationAuthorization: SessionAdministrationAuthorizationPort,
    @Inject(SESSION_METRICS_PORT) private readonly metrics: SessionMetricsPort,
  ) {}

  async establish(
    identity: SessionEstablishmentPrincipal,
    providerIdentity: Pick<NormalizedProviderIdentity, 'assurance' | 'authenticatedAt'>,
    incomingCookie: ParsedSessionCookie,
  ): Promise<EstablishedSession> {
    const now = this.clock.now();
    const material = this.credentials.generate();
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.absoluteTtlSeconds * 1_000,
    );
    const idleExpiresAt = new Date(
      Math.min(
        absoluteExpiresAt.getTime(),
        now.getTime() + this.config.idleTtlSeconds * 1_000,
      ),
    );
    try {
      const result = await this.repository.issue({
        ...identity,
        credentialHash: material.hash,
        ...(incomingCookie.status === 'present'
          ? { incomingCredentialHash: this.credentials.hash(incomingCookie.credential) }
          : {}),
        issuedAt: now,
        authenticatedAt: providerIdentity.authenticatedAt,
        idleExpiresAt,
        absoluteExpiresAt,
        assuranceLevel: providerIdentity.assurance.level,
      });
      this.metrics.record({ operation: 'issue', outcome: 'succeeded' });
      return {
        principal: result.principal,
        cookie: {
          kind: 'set',
          credential: material.credential,
          absoluteExpiresAt: result.principal.absoluteExpiresAt,
          issuedAt: result.principal.issuedAt,
        },
      };
    } catch (error) {
      this.metrics.record({ operation: 'issue', outcome: 'failed' });
      throw error;
    }
  }

  async resolveCookie(cookie: ParsedSessionCookie): Promise<CookieResolution> {
    if (cookie.status === 'missing') {
      this.metrics.record({ operation: 'resolve', outcome: 'denied', category: 'missing' });
      return { principal: null, cookie: null };
    }
    if (cookie.status === 'invalid') {
      this.metrics.record({ operation: 'resolve', outcome: 'denied', category: 'malformed' });
      return { principal: null, cookie: { kind: 'clear' } };
    }
    const resolved = await this.repository.resolve({
      credentialHash: this.credentials.hash(cookie.credential),
      now: this.clock.now(),
      idleTtlSeconds: this.config.idleTtlSeconds,
    });
    if (resolved.status === 'invalid') {
      this.metrics.record({
        operation: 'resolve',
        outcome: 'denied',
        category: resolved.reason,
      });
      return { principal: null, cookie: { kind: 'clear' } };
    }
    this.metrics.record({ operation: 'resolve', outcome: 'succeeded' });
    return { principal: resolved.principal, cookie: null };
  }

  async requirePrincipal(cookie: ParsedSessionCookie): Promise<CookieResolution & {
    readonly principal: SessionPrincipal;
  }> {
    const resolution = await this.resolveCookie(cookie);
    if (!resolution.principal) throw Object.assign(sessionAuthenticationRequired(), {
      sessionCookieInstruction: resolution.cookie,
    });
    return { ...resolution, principal: resolution.principal };
  }

  async listSelf(principal: SessionPrincipal): Promise<readonly SessionView[]> {
    await this.requireSessionAuthorization(
      principal,
      SESSION_SELF_ACTIONS.read,
      'employee-sessions',
      principal.employeeId,
      true,
    );
    return this.repository.listSelf({ principal, now: this.clock.now() });
  }

  async revokeSelf(principal: SessionPrincipal, sessionIdInput: string): Promise<{
    readonly status: 'revoked' | 'idempotent';
    readonly currentSessionRevoked: boolean;
  }> {
    const sessionId = parseSessionId(sessionIdInput);
    await this.requireSessionAuthorization(
      principal,
      SESSION_SELF_ACTIONS.revoke,
      'session',
      sessionId,
      true,
    );
    const status = await this.repository.revokeSelf({
      principal,
      sessionId,
      now: this.clock.now(),
    });
    if (status === 'not_found') throw sessionNotFound();
    this.metrics.record({ operation: 'revoke', outcome: 'succeeded', category: status });
    return { status, currentSessionRevoked: sessionId === principal.sessionId };
  }

  async revokeAllSelf(principal: SessionPrincipal, body: unknown): Promise<{
    readonly revokedCount: number;
    readonly currentSessionRevoked: boolean;
  }> {
    const { includeCurrent } = parseRevokeAllBody(body);
    await this.requireSessionAuthorization(
      principal,
      SESSION_SELF_ACTIONS.revoke,
      'employee-sessions',
      principal.employeeId,
      true,
    );
    const result = await this.repository.revokeAllSelf({
      principal,
      includeCurrent,
      now: this.clock.now(),
    });
    this.metrics.record({ operation: 'revoke_all', outcome: 'succeeded' });
    return {
      revokedCount: result.revokedCount,
      currentSessionRevoked: result.currentRevoked,
    };
  }

  async listAdministration(
    actor: SessionPrincipal,
    employeeIdInput?: string,
    pageInput?: string,
    pageSizeInput?: string,
  ): Promise<SessionPage> {
    const employeeId = employeeIdInput ? parseSessionId(employeeIdInput) : undefined;
    await this.requireSessionAuthorization(
      actor,
      SESSION_ADMINISTRATION_ACTIONS.read,
      'employee-sessions',
      employeeId,
    );
    const pagination = parseSessionPagination(pageInput, pageSizeInput);
    return this.repository.listAdministration({
      organizationId: actor.organizationId,
      ...(employeeId ? { employeeId } : {}),
      ...pagination,
      currentSessionId: actor.sessionId,
      now: this.clock.now(),
    });
  }

  async revokeAdministration(actor: SessionPrincipal, sessionIdInput: string): Promise<{
    readonly status: 'revoked' | 'idempotent';
    readonly currentSessionRevoked: boolean;
  }> {
    const sessionId = parseSessionId(sessionIdInput);
    await this.requireSessionAuthorization(
      actor,
      SESSION_ADMINISTRATION_ACTIONS.revoke,
      'session',
      sessionId,
    );
    const status = await this.repository.revokeAdministration({
      actor,
      sessionId,
      now: this.clock.now(),
    });
    if (status === 'not_found') throw sessionNotFound();
    this.metrics.record({ operation: 'revoke', outcome: 'succeeded', category: status });
    return { status, currentSessionRevoked: sessionId === actor.sessionId };
  }

  async revokeAllAdministration(
    actor: SessionPrincipal,
    employeeIdInput: string,
    body: unknown,
  ): Promise<{ readonly revokedCount: number; readonly currentSessionRevoked: boolean }> {
    const employeeId = parseSessionId(employeeIdInput);
    const { includeCurrent } = parseRevokeAllBody(body);
    await this.requireSessionAuthorization(
      actor,
      SESSION_ADMINISTRATION_ACTIONS.revoke,
      'employee-sessions',
      employeeId,
    );
    const result = await this.repository.revokeAllForEmployee({
      organizationId: actor.organizationId,
      employeeId,
      actorEmployeeId: actor.employeeId,
      actorAccountId: actor.userAccountId,
      currentSessionId: actor.sessionId,
      includeCurrent,
      reason: 'administrative_revoke_all',
      now: this.clock.now(),
    });
    if (!result) throw sessionNotFound();
    this.metrics.record({ operation: 'revoke_all', outcome: 'succeeded' });
    return {
      revokedCount: result.revokedCount,
      currentSessionRevoked: result.currentRevoked,
    };
  }

  revokeAllForEmployee(input: {
    readonly organizationId: string;
    readonly employeeId: string;
    readonly now?: Date;
  }) {
    return this.repository.revokeAllForEmployee({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      includeCurrent: true,
      reason: 'employee_lifecycle_revocation',
      now: input.now ?? this.clock.now(),
    });
  }

  recordCsrfDenied(category: 'missing_origin' | 'foreign_origin'): void {
    this.metrics.record({ operation: 'csrf', outcome: 'denied', category });
  }

  private async requireSessionAuthorization(
    actor: SessionPrincipal,
    action:
      | (typeof SESSION_ADMINISTRATION_ACTIONS)[keyof typeof SESSION_ADMINISTRATION_ACTIONS]
      | (typeof SESSION_SELF_ACTIONS)[keyof typeof SESSION_SELF_ACTIONS],
    type: 'session' | 'employee-sessions',
    id?: string,
    self = false,
  ): Promise<void> {
    const allowed = await this.administrationAuthorization.allows({
      actor,
      action,
      resource: {
        type,
        organizationId: actor.organizationId,
        ...(id ? { id } : {}),
        ...(self
          ? {
              ownerEmployeeId: actor.employeeId,
              ownerUserAccountId: actor.userAccountId,
            }
          : {}),
      },
    });
    if (!allowed) throw sessionAuthorizationDenied();
  }
}
