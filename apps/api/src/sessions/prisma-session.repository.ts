import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_CLIENT,
  Prisma,
  runInTransaction,
  type DatabaseClient,
  type DatabaseTransaction,
} from '@dar-tech/database';
import {
  REQUEST_CONTEXT_STORE,
  type RequestContextStore,
} from '@dar-tech/observability';
import { persistOutboxEvent } from '@dar-tech/outbox';
import {
  AUDIT_ACTION_KEYS,
  AUDIT_EVENT_APPEND_PORT,
  SECURITY_EVENT_APPEND_PORT,
  SECURITY_EVENT_TYPES,
  type AuditEventAppendPort,
  type HistoricalActorSnapshot,
  type SecurityEventAppendPort,
} from '../event-history/event-history.contracts.js';
import {
  type SessionIssueInput,
  type SessionIssueResult,
  type SessionPage,
  type SessionPrincipal,
  type SessionRepositoryPort,
  type SessionResolution,
  type SessionStatus,
  type SessionView,
} from './session.contracts.js';
import { SESSION_EVENT_CONTRACTS } from './session.events.js';

interface LockedOwner {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly accountEmployeeId: string;
  readonly lifecycleStatus: string;
  readonly authenticationEligible: boolean;
  readonly disabledAt: Date | null;
  readonly displayName: string;
  readonly employeeCode: string;
}

interface RawSession {
  readonly id: string;
  readonly organizationId: string;
  readonly userAccountId: string;
  readonly employeeId: string;
  readonly issuedAt: Date;
  readonly authenticatedAt: Date | null;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedByEmployeeId: string | null;
  readonly safeRevocationReason: string | null;
  readonly assuranceLevel: string | null;
  readonly lastStepUpAt: Date | null;
}

function principal(session: RawSession): SessionPrincipal {
  return {
    sessionId: session.id,
    organizationId: session.organizationId,
    userAccountId: session.userAccountId,
    employeeId: session.employeeId,
    clientKind: 'browser',
    assuranceLevel: session.assuranceLevel,
    authenticatedAt: session.authenticatedAt,
    issuedAt: session.issuedAt,
    lastSeenAt: session.lastSeenAt,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
  };
}

function statusOf(
  session: Pick<RawSession, 'revokedAt' | 'idleExpiresAt' | 'absoluteExpiresAt'>,
  now: Date,
  eligible = true,
): SessionStatus {
  if (session.revokedAt) return 'REVOKED';
  if (!eligible) return 'INACTIVE';
  if (now.getTime() >= session.absoluteExpiresAt.getTime()) return 'ABSOLUTE_EXPIRED';
  if (now.getTime() >= session.idleExpiresAt.getTime()) return 'IDLE_EXPIRED';
  return 'ACTIVE';
}

function view(session: RawSession, now: Date, currentSessionId: string, eligible = true): SessionView {
  return {
    id: session.id,
    current: session.id === currentSessionId,
    clientKind: 'browser',
    assuranceLevel: session.assuranceLevel,
    authenticatedAt: session.authenticatedAt,
    issuedAt: session.issuedAt,
    lastSeenAt: session.lastSeenAt,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    revokedAt: session.revokedAt,
    status: statusOf(session, now, eligible),
  };
}

function snapshot(owner: LockedOwner): HistoricalActorSnapshot {
  return {
    type: 'employee',
    displayName: owner.displayName,
    employeeCode: owner.employeeCode,
  };
}

@Injectable()
export class PrismaSessionRepository implements SessionRepositoryPort {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AUDIT_EVENT_APPEND_PORT) private readonly audit: AuditEventAppendPort,
    @Inject(SECURITY_EVENT_APPEND_PORT) private readonly security: SecurityEventAppendPort,
    @Inject(REQUEST_CONTEXT_STORE) private readonly contextStore: RequestContextStore,
  ) {}

  async issue(input: SessionIssueInput): Promise<SessionIssueResult> {
    const incomingReference = input.incomingCredentialHash
      ? await this.client.session.findUnique({
          where: { credentialHash: input.incomingCredentialHash },
          select: { organizationId: true, employeeId: true, userAccountId: true },
        })
      : null;
    const rotateIncoming =
      incomingReference?.organizationId === input.organizationId &&
      incomingReference.employeeId === input.employeeId &&
      incomingReference.userAccountId === input.userAccountId;
    return runInTransaction(this.client, async (transaction) => {
      const target = await this.lockOwner(
        transaction,
        input.organizationId,
        input.employeeId,
      );
      if (!target || target.userAccountId !== input.userAccountId || !this.isEligible(target)) {
        throw new Error('Session issuance identity is ineligible');
      }

      let rotated: RawSession | null = null;
      if (input.incomingCredentialHash && rotateIncoming) {
        const candidate = await this.lockByCredentialHash(transaction, input.incomingCredentialHash);
        if (
          candidate &&
          candidate.organizationId === input.organizationId &&
          candidate.employeeId === input.employeeId &&
          candidate.userAccountId === input.userAccountId &&
          statusOf(candidate, input.issuedAt) === 'ACTIVE'
        ) {
          rotated = await this.markRevoked(
            transaction,
            candidate,
            input.issuedAt,
            input.employeeId,
            'authentication_rotation',
          );
          await this.recordSingleRevocation(
            transaction,
            rotated,
            target,
            target,
            input.employeeId,
            input.userAccountId,
            AUDIT_ACTION_KEYS.sessionRevokedSelf,
            'MEDIUM',
            input.issuedAt,
          );
        }
      }

      const created = await transaction.session.create({
        data: {
          organizationId: input.organizationId,
          userAccountId: input.userAccountId,
          employeeId: input.employeeId,
          credentialHash: input.credentialHash,
          clientKind: 'BROWSER',
          issuedAt: input.issuedAt,
          authenticatedAt: input.authenticatedAt,
          lastSeenAt: input.issuedAt,
          idleExpiresAt: input.idleExpiresAt,
          absoluteExpiresAt: input.absoluteExpiresAt,
          assuranceLevel: input.assuranceLevel,
          lastStepUpAt: null,
        },
        select: this.sessionSelect(),
      });
      await this.recordCreation(transaction, created, target, input.issuedAt);
      return { principal: principal(created), rotatedSessionId: rotated?.id ?? null };
    });
  }

  async resolve(input: {
    readonly credentialHash: string;
    readonly now: Date;
    readonly idleTtlSeconds: number;
  }): Promise<SessionResolution> {
    const reference = await this.client.session.findUnique({
      where: { credentialHash: input.credentialHash },
      select: { organizationId: true, employeeId: true },
    });
    if (!reference) return { status: 'invalid', reason: 'unknown' };
    return runInTransaction(this.client, async (transaction) => {
      const owner = await this.lockOwner(
        transaction,
        reference.organizationId,
        reference.employeeId,
      );
      const session = await this.lockByCredentialHash(transaction, input.credentialHash);
      if (!session) return { status: 'invalid', reason: 'unknown' };
      if (session.revokedAt) return { status: 'invalid', reason: 'revoked' };
      if (input.now.getTime() >= session.absoluteExpiresAt.getTime()) {
        return { status: 'invalid', reason: 'absolute_expired' };
      }
      if (input.now.getTime() >= session.idleExpiresAt.getTime()) {
        return { status: 'invalid', reason: 'idle_expired' };
      }
      if (
        !owner ||
        !this.isEligible(owner) ||
        owner.userAccountId !== session.userAccountId ||
        owner.employeeId !== session.employeeId ||
        owner.organizationId !== session.organizationId
      ) {
        return { status: 'invalid', reason: 'ineligible' };
      }
      const lastSeenAt = new Date(Math.max(session.lastSeenAt.getTime(), input.now.getTime()));
      const idleExpiresAt = new Date(
        Math.min(
          session.absoluteExpiresAt.getTime(),
          input.now.getTime() + input.idleTtlSeconds * 1_000,
        ),
      );
      const touched = await transaction.session.update({
        where: { id: session.id },
        data: { lastSeenAt, idleExpiresAt },
        select: this.sessionSelect(),
      });
      return { status: 'active', principal: principal(touched) };
    });
  }

  async listSelf(input: {
    readonly principal: SessionPrincipal;
    readonly now: Date;
  }): Promise<readonly SessionView[]> {
    const sessions = await this.client.session.findMany({
      where: {
        organizationId: input.principal.organizationId,
        userAccountId: input.principal.userAccountId,
        employeeId: input.principal.employeeId,
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      select: this.sessionSelect(),
    });
    return sessions.map((session) => view(session, input.now, input.principal.sessionId));
  }

  revokeSelf(input: {
    readonly principal: SessionPrincipal;
    readonly sessionId: string;
    readonly now: Date;
  }): Promise<'revoked' | 'idempotent' | 'not_found'> {
    return this.revokeSingle({
      organizationId: input.principal.organizationId,
      employeeId: input.principal.employeeId,
      userAccountId: input.principal.userAccountId,
      sessionId: input.sessionId,
      actorEmployeeId: input.principal.employeeId,
      actorAccountId: input.principal.userAccountId,
      actionKey: AUDIT_ACTION_KEYS.sessionRevokedSelf,
      reason: 'self_revocation',
      risk: 'MEDIUM',
      now: input.now,
    });
  }

  revokeAllSelf(input: {
    readonly principal: SessionPrincipal;
    readonly includeCurrent: boolean;
    readonly now: Date;
  }): Promise<{ readonly revokedCount: number; readonly currentRevoked: boolean }> {
    return this.revokeAll({
      organizationId: input.principal.organizationId,
      employeeId: input.principal.employeeId,
      actorEmployeeId: input.principal.employeeId,
      actorAccountId: input.principal.userAccountId,
      currentSessionId: input.principal.sessionId,
      includeCurrent: input.includeCurrent,
      reason: 'self_revoke_all',
      actionKey: AUDIT_ACTION_KEYS.sessionsRevokedSelf,
      risk: 'MEDIUM',
      now: input.now,
    }).then((result) => result ?? { revokedCount: 0, currentRevoked: false });
  }

  async listAdministration(input: {
    readonly organizationId: string;
    readonly employeeId?: string;
    readonly page: number;
    readonly pageSize: number;
    readonly currentSessionId: string;
    readonly now: Date;
  }): Promise<SessionPage> {
    const where = {
      organizationId: input.organizationId,
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
    };
    const [total, sessions] = await this.client.$transaction([
      this.client.session.count({ where }),
      this.client.session.findMany({
        where,
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          ...this.sessionSelect(),
          employee: { select: { lifecycleStatus: true } },
          userAccount: { select: { authenticationEligible: true, disabledAt: true } },
        },
      }),
    ]);
    return {
      items: sessions.map((session) => ({
        ...view(
          session,
          input.now,
          input.currentSessionId,
          session.employee.lifecycleStatus === 'ACTIVE' &&
            session.userAccount.authenticationEligible &&
            session.userAccount.disabledAt === null,
        ),
        employeeId: session.employeeId,
        userAccountId: session.userAccountId,
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  revokeAdministration(input: {
    readonly actor: SessionPrincipal;
    readonly sessionId: string;
    readonly now: Date;
  }): Promise<'revoked' | 'idempotent' | 'not_found'> {
    return this.revokeSingle({
      organizationId: input.actor.organizationId,
      sessionId: input.sessionId,
      actorEmployeeId: input.actor.employeeId,
      actorAccountId: input.actor.userAccountId,
      actionKey: AUDIT_ACTION_KEYS.sessionRevokedAdmin,
      reason: 'administrative_revocation',
      risk: 'HIGH',
      now: input.now,
    });
  }

  revokeAllForEmployee(input: {
    readonly organizationId: string;
    readonly employeeId: string;
    readonly actorEmployeeId?: string;
    readonly actorAccountId?: string;
    readonly currentSessionId?: string;
    readonly includeCurrent: boolean;
    readonly reason: 'administrative_revoke_all' | 'employee_lifecycle_revocation';
    readonly now: Date;
  }): Promise<{ readonly revokedCount: number; readonly currentRevoked: boolean } | null> {
    return this.revokeAll({
      ...input,
      actionKey: AUDIT_ACTION_KEYS.sessionsRevokedAdmin,
      risk: 'HIGH',
    });
  }

  private async revokeSingle(input: {
    readonly organizationId: string;
    readonly employeeId?: string;
    readonly userAccountId?: string;
    readonly sessionId: string;
    readonly actorEmployeeId: string;
    readonly actorAccountId: string;
    readonly actionKey:
      | typeof AUDIT_ACTION_KEYS.sessionRevokedSelf
      | typeof AUDIT_ACTION_KEYS.sessionRevokedAdmin;
    readonly reason: 'self_revocation' | 'administrative_revocation';
    readonly risk: 'MEDIUM' | 'HIGH';
    readonly now: Date;
  }): Promise<'revoked' | 'idempotent' | 'not_found'> {
    const reference = await this.client.session.findFirst({
      where: {
        id: input.sessionId,
        organizationId: input.organizationId,
        ...(input.employeeId ? { employeeId: input.employeeId } : {}),
        ...(input.userAccountId ? { userAccountId: input.userAccountId } : {}),
      },
      select: { employeeId: true },
    });
    if (!reference) return 'not_found';
    return runInTransaction(this.client, async (transaction) => {
      const ownerKeys = new Map<string, string>();
      ownerKeys.set(reference.employeeId, reference.employeeId);
      ownerKeys.set(input.actorEmployeeId, input.actorEmployeeId);
      const owners: LockedOwner[] = [];
      for (const employeeId of [...ownerKeys.values()].sort()) {
        const locked = await this.lockOwner(transaction, input.organizationId, employeeId);
        if (locked) owners.push(locked);
      }
      const owner = owners.find(({ employeeId }) => employeeId === reference.employeeId);
      const actorOwner = owners.find(({ employeeId }) => employeeId === input.actorEmployeeId);
      if (!owner) return 'not_found';
      const session = await this.lockById(transaction, input.organizationId, input.sessionId);
      if (
        !session ||
        (input.employeeId && session.employeeId !== input.employeeId) ||
        (input.userAccountId && session.userAccountId !== input.userAccountId)
      ) {
        return 'not_found';
      }
      if (session.revokedAt) return 'idempotent';
      const revoked = await this.markRevoked(
        transaction,
        session,
        input.now,
        input.actorEmployeeId,
        input.reason,
      );
      await this.recordSingleRevocation(
        transaction,
        revoked,
        owner,
        actorOwner ?? null,
        input.actorEmployeeId,
        input.actorAccountId,
        input.actionKey,
        input.risk,
        input.now,
      );
      return 'revoked';
    });
  }

  private async revokeAll(input: {
    readonly organizationId: string;
    readonly employeeId: string;
    readonly actorEmployeeId?: string;
    readonly actorAccountId?: string;
    readonly currentSessionId?: string;
    readonly includeCurrent: boolean;
    readonly reason:
      | 'self_revoke_all'
      | 'administrative_revoke_all'
      | 'employee_lifecycle_revocation';
    readonly actionKey:
      | typeof AUDIT_ACTION_KEYS.sessionsRevokedSelf
      | typeof AUDIT_ACTION_KEYS.sessionsRevokedAdmin;
    readonly risk: 'MEDIUM' | 'HIGH';
    readonly now: Date;
  }): Promise<{ readonly revokedCount: number; readonly currentRevoked: boolean } | null> {
    return runInTransaction(this.client, async (transaction) => {
      const employeeIds = [input.employeeId, ...(input.actorEmployeeId ? [input.actorEmployeeId] : [])];
      const owners: LockedOwner[] = [];
      for (const employeeId of [...new Set(employeeIds)].sort()) {
        const locked = await this.lockOwner(transaction, input.organizationId, employeeId);
        if (locked) owners.push(locked);
      }
      const owner = owners.find(({ employeeId }) => employeeId === input.employeeId);
      if (!owner) return null;
      const actor = input.actorEmployeeId
        ? owners.find(({ employeeId }) => employeeId === input.actorEmployeeId) ?? null
        : null;
      const sessions = await this.lockForEmployee(transaction, input.organizationId, input.employeeId);
      const candidates = sessions.filter(
        (session) =>
          !session.revokedAt &&
          (input.includeCurrent || !input.currentSessionId || session.id !== input.currentSessionId),
      );
      if (candidates.length === 0) return { revokedCount: 0, currentRevoked: false };
      const candidateIds = candidates.map(({ id }) => id);
      await transaction.session.updateMany({
        where: { id: { in: candidateIds }, revokedAt: null },
        data: {
          revokedAt: input.now,
          ...(input.actorEmployeeId ? { revokedByEmployeeId: input.actorEmployeeId } : {}),
          safeRevocationReason: input.reason,
        },
      });
      const currentRevoked = Boolean(
        input.currentSessionId && candidateIds.includes(input.currentSessionId),
      );
      const actorHistory = actor ? snapshot(actor) : { type: 'system' as const };
      const history = this.historyContext();
      await this.audit.append(
        {
          organizationId: input.organizationId,
          actionKey: input.actionKey,
          ...(input.actorEmployeeId ? { actorEmployeeId: input.actorEmployeeId } : {}),
          actorSnapshot: actorHistory,
          targetType: 'employee-sessions',
          targetId: input.employeeId,
          targetSnapshot: {
            displayName: owner.displayName,
            employeeCode: owner.employeeCode,
          },
          ...(input.currentSessionId ? { sessionReference: input.currentSessionId } : {}),
          safeReason: input.reason,
          changeDelta: { changedFields: ['revokedAt'] },
          ...history,
          occurredAt: input.now,
        },
        transaction,
      );
      await this.security.append(
        {
          organizationId: input.organizationId,
          eventType: SECURITY_EVENT_TYPES.allSessionsRevoked,
          category: 'session',
          risk: input.risk,
          outcome: 'succeeded',
          ...(input.actorEmployeeId ? { actorEmployeeId: input.actorEmployeeId } : {}),
          ...(input.actorAccountId ? { actorAccountId: input.actorAccountId } : {}),
          actorSnapshot: actorHistory,
          ...(input.currentSessionId ? { sessionReference: input.currentSessionId } : {}),
          safeContext: {
            revokedCount: candidateIds.length,
            includeCurrent: input.includeCurrent,
            reason: input.reason,
          },
          ...history,
          occurredAt: input.now,
        },
        transaction,
      );
      await this.outbox(
        transaction,
        SESSION_EVENT_CONTRACTS.allSessionsRevoked,
        input.organizationId,
        {
          organizationId: input.organizationId,
          employeeId: input.employeeId,
          revokedCount: candidateIds.length,
          includeCurrent: input.includeCurrent,
          occurredAt: input.now.toISOString(),
        },
        input.now,
      );
      return { revokedCount: candidateIds.length, currentRevoked };
    });
  }

  private async recordCreation(
    transaction: DatabaseTransaction,
    session: RawSession,
    owner: LockedOwner,
    occurredAt: Date,
  ): Promise<void> {
    const history = this.historyContext();
    const actor = snapshot(owner);
    await this.audit.append(
      {
        organizationId: session.organizationId,
        actionKey: AUDIT_ACTION_KEYS.sessionCreated,
        actorEmployeeId: session.employeeId,
        actorSnapshot: actor,
        targetType: 'session',
        targetId: session.id,
        targetSnapshot: {
          displayName: owner.displayName,
          employeeCode: owner.employeeCode,
        },
        sessionReference: session.id,
        ...history,
        occurredAt,
      },
      transaction,
    );
    await this.security.append(
      {
        organizationId: session.organizationId,
        eventType: SECURITY_EVENT_TYPES.sessionCreated,
        category: 'session',
        risk: 'LOW',
        outcome: 'succeeded',
        actorEmployeeId: session.employeeId,
        actorAccountId: session.userAccountId,
        actorSnapshot: actor,
        sessionReference: session.id,
        safeContext: {
          clientKind: 'browser',
          assuranceLevel: session.assuranceLevel,
          idleExpiresAt: session.idleExpiresAt.toISOString(),
          absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
        },
        ...history,
        occurredAt,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      SESSION_EVENT_CONTRACTS.sessionCreated,
      session.organizationId,
      {
        organizationId: session.organizationId,
        employeeId: session.employeeId,
        userAccountId: session.userAccountId,
        sessionId: session.id,
        clientKind: 'browser',
        issuedAt: session.issuedAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      },
      occurredAt,
    );
  }

  private async recordSingleRevocation(
    transaction: DatabaseTransaction,
    session: RawSession,
    owner: LockedOwner,
    actorOwner: LockedOwner | null,
    actorEmployeeId: string,
    actorAccountId: string,
    actionKey:
      | typeof AUDIT_ACTION_KEYS.sessionRevokedSelf
      | typeof AUDIT_ACTION_KEYS.sessionRevokedAdmin,
    risk: 'MEDIUM' | 'HIGH',
    occurredAt: Date,
  ): Promise<void> {
    const actor = actorOwner ? snapshot(actorOwner) : { type: 'unresolved' as const };
    const history = this.historyContext();
    await this.audit.append(
      {
        organizationId: session.organizationId,
        actionKey,
        actorEmployeeId,
        actorSnapshot: actor,
        targetType: 'session',
        targetId: session.id,
        targetSnapshot: {
          displayName: owner.displayName,
          employeeCode: owner.employeeCode,
        },
        sessionReference: session.id,
        ...(session.safeRevocationReason
          ? { safeReason: session.safeRevocationReason }
          : {}),
        changeDelta: { changedFields: ['revokedAt'] },
        ...history,
        occurredAt,
      },
      transaction,
    );
    await this.security.append(
      {
        organizationId: session.organizationId,
        eventType: SECURITY_EVENT_TYPES.sessionRevoked,
        category: 'session',
        risk,
        outcome: 'succeeded',
        actorEmployeeId,
        actorAccountId,
        actorSnapshot: actor,
        sessionReference: session.id,
        safeContext: { reason: session.safeRevocationReason ?? 'unspecified' },
        ...history,
        occurredAt,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      SESSION_EVENT_CONTRACTS.sessionRevoked,
      session.organizationId,
      {
        organizationId: session.organizationId,
        employeeId: session.employeeId,
        userAccountId: session.userAccountId,
        sessionId: session.id,
        reason: session.safeRevocationReason,
        revokedAt: occurredAt.toISOString(),
      },
      occurredAt,
    );
  }

  private markRevoked(
    transaction: DatabaseTransaction,
    session: RawSession,
    revokedAt: Date,
    revokedByEmployeeId: string,
    safeRevocationReason: string,
  ): Promise<RawSession> {
    return transaction.session.update({
      where: { id: session.id },
      data: { revokedAt, revokedByEmployeeId, safeRevocationReason },
      select: this.sessionSelect(),
    });
  }

  private async lockOwner(
    transaction: DatabaseTransaction,
    organizationId: string,
    employeeId: string,
  ): Promise<LockedOwner | null> {
    const rows = await transaction.$queryRaw<LockedOwner[]>(Prisma.sql`
      SELECT
        employee."organization_id" AS "organizationId",
        employee."id" AS "employeeId",
        account."id" AS "userAccountId",
        account."employee_id" AS "accountEmployeeId",
        employee."lifecycle_status" AS "lifecycleStatus",
        account."authentication_eligible" AS "authenticationEligible",
        account."disabled_at" AS "disabledAt",
        employee."display_name" AS "displayName",
        employee."employee_code" AS "employeeCode"
      FROM "employees" AS employee
      INNER JOIN "user_accounts" AS account
        ON account."organization_id" = employee."organization_id"
        AND account."employee_id" = employee."id"
      WHERE employee."organization_id" = ${organizationId}::uuid
        AND employee."id" = ${employeeId}::uuid
      FOR UPDATE OF employee, account
    `);
    return rows[0] ?? null;
  }

  private lockByCredentialHash(
    transaction: DatabaseTransaction,
    credentialHash: string,
  ): Promise<RawSession | null> {
    return this.lockSession(transaction, Prisma.sql`"credential_hash" = ${credentialHash}`);
  }

  private lockById(
    transaction: DatabaseTransaction,
    organizationId: string,
    sessionId: string,
  ): Promise<RawSession | null> {
    return this.lockSession(
      transaction,
      Prisma.sql`"organization_id" = ${organizationId}::uuid AND "id" = ${sessionId}::uuid`,
    );
  }

  private async lockSession(
    transaction: DatabaseTransaction,
    predicate: Prisma.Sql,
  ): Promise<RawSession | null> {
    const rows = await transaction.$queryRaw<RawSession[]>(Prisma.sql`
      SELECT
        "id", "organization_id" AS "organizationId",
        "user_account_id" AS "userAccountId", "employee_id" AS "employeeId",
        "issued_at" AS "issuedAt", "authenticated_at" AS "authenticatedAt",
        "last_seen_at" AS "lastSeenAt", "idle_expires_at" AS "idleExpiresAt",
        "absolute_expires_at" AS "absoluteExpiresAt", "revoked_at" AS "revokedAt",
        "revoked_by_employee_id" AS "revokedByEmployeeId",
        "safe_revocation_reason" AS "safeRevocationReason",
        "assurance_level" AS "assuranceLevel", "last_step_up_at" AS "lastStepUpAt"
      FROM "sessions"
      WHERE ${predicate}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private lockForEmployee(
    transaction: DatabaseTransaction,
    organizationId: string,
    employeeId: string,
  ): Promise<RawSession[]> {
    return transaction.$queryRaw<RawSession[]>(Prisma.sql`
      SELECT
        "id", "organization_id" AS "organizationId",
        "user_account_id" AS "userAccountId", "employee_id" AS "employeeId",
        "issued_at" AS "issuedAt", "authenticated_at" AS "authenticatedAt",
        "last_seen_at" AS "lastSeenAt", "idle_expires_at" AS "idleExpiresAt",
        "absolute_expires_at" AS "absoluteExpiresAt", "revoked_at" AS "revokedAt",
        "revoked_by_employee_id" AS "revokedByEmployeeId",
        "safe_revocation_reason" AS "safeRevocationReason",
        "assurance_level" AS "assuranceLevel", "last_step_up_at" AS "lastStepUpAt"
      FROM "sessions"
      WHERE "organization_id" = ${organizationId}::uuid
        AND "employee_id" = ${employeeId}::uuid
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private isEligible(owner: LockedOwner): boolean {
    return (
      owner.accountEmployeeId === owner.employeeId &&
      owner.lifecycleStatus === 'ACTIVE' &&
      owner.authenticationEligible &&
      owner.disabledAt === null
    );
  }

  private sessionSelect() {
    return {
      id: true,
      organizationId: true,
      userAccountId: true,
      employeeId: true,
      issuedAt: true,
      authenticatedAt: true,
      lastSeenAt: true,
      idleExpiresAt: true,
      absoluteExpiresAt: true,
      revokedAt: true,
      revokedByEmployeeId: true,
      safeRevocationReason: true,
      assuranceLevel: true,
      lastStepUpAt: true,
    } as const;
  }

  private historyContext(): { readonly requestId?: string; readonly correlationId: string } {
    const context = this.contextStore.get();
    return {
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      correlationId: context?.correlationId ?? randomUUID(),
    };
  }

  private outbox(
    transaction: DatabaseTransaction,
    contract: { readonly eventType: string; readonly eventVersion: number },
    organizationId: string,
    payload: unknown,
    occurredAt: Date,
  ): Promise<{ readonly eventId: string }> {
    const context = this.historyContext();
    return persistOutboxEvent(transaction, {
      eventType: contract.eventType,
      eventVersion: contract.eventVersion,
      payload,
      organizationId,
      correlationId: context.correlationId,
      ...(context.requestId ? { causationId: context.requestId } : {}),
      occurredAt,
    });
  }
}
