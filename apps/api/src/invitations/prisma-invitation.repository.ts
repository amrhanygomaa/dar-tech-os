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
  STRUCTURED_LOGGER,
  type RequestContextStore,
  type StructuredLogger,
} from '@dar-tech/observability';
import { persistOutboxEvent } from '@dar-tech/outbox';
import {
  AUDIT_ACTION_KEYS,
  AUDIT_EVENT_APPEND_PORT,
  SECURITY_EVENT_APPEND_PORT,
  SECURITY_EVENT_TYPES,
  type AuditEventAppendPort,
  type HistoricalActorSnapshot,
  type HistoricalTargetSnapshot,
  type SecurityEventAppendPort,
} from '../event-history/event-history.contracts.js';
import { IDENTITY_EVENT_CONTRACTS } from '../identity/identity.events.js';
import type {
  AcceptancePersistenceResult,
  InvitationPage,
  InvitationRepositoryPort,
  InvitationStatus,
  InvitationView,
  RevocationResult,
} from './invitation.contracts.js';
import { INVITATION_EVENT_CONTRACTS } from './invitation.events.js';

const invitationSelect = {
  id: true,
  organizationId: true,
  employeeId: true,
  userAccountId: true,
  invitedEmailNormalized: true,
  status: true,
  issuerEmployeeId: true,
  issuedAt: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  revokedByEmployeeId: true,
  safeRevocationReason: true,
  supersededAt: true,
  supersededByInvitationId: true,
  onboardingCompletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InvitationSelect;

type RawInvitation = Prisma.InvitationGetPayload<{
  select: typeof invitationSelect;
}>;

type LockedInvitation = RawInvitation;

interface LockedInvitationTarget {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly workEmail: string;
  readonly lifecycleStatus: string;
  readonly employeeActivatedAt: Date | null;
  readonly userAccountId: string;
  readonly accountEmployeeId: string;
  readonly authenticationEligible: boolean;
  readonly accountActivatedAt: Date | null;
  readonly disabledAt: Date | null;
}

function view(invitation: RawInvitation): InvitationView {
  return { ...invitation, status: invitation.status as InvitationStatus };
}

function actorSnapshot(employee: {
  readonly displayName: string;
  readonly employeeCode: string;
}): HistoricalActorSnapshot {
  return { type: 'employee', ...employee };
}

function targetSnapshot(employee: {
  readonly displayName: string;
  readonly employeeCode: string;
}): HistoricalTargetSnapshot {
  return employee;
}

@Injectable()
export class PrismaInvitationRepository implements InvitationRepositoryPort {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AUDIT_EVENT_APPEND_PORT)
    private readonly audit: AuditEventAppendPort,
    @Inject(SECURITY_EVENT_APPEND_PORT)
    private readonly security: SecurityEventAppendPort,
    @Inject(REQUEST_CONTEXT_STORE)
    private readonly contextStore: RequestContextStore,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  issue(input: Parameters<InvitationRepositoryPort['issue']>[0]): Promise<InvitationView> {
    return runInTransaction(this.client, async (transaction) => {
      const issuer = await transaction.employee.findFirst({
        where: {
          id: input.actor.employeeId,
          organizationId: input.actor.organizationId,
        },
        select: { displayName: true, employeeCode: true },
      });
      if (!issuer) throw new Error('Trusted invitation issuer was not found');

      const employee = await transaction.employee.create({
        data: {
          organizationId: input.actor.organizationId,
          employeeCode: input.employee.employeeCode,
          firstName: input.employee.firstName,
          lastName: input.employee.lastName,
          displayName: input.employee.displayName,
          workEmail: input.employee.workEmail,
          lifecycleStatus: 'INVITED',
          invitedAt: input.issuedAt,
        },
        select: { id: true, displayName: true, employeeCode: true },
      });
      const account = await transaction.userAccount.create({
        data: {
          organizationId: input.actor.organizationId,
          employeeId: employee.id,
          authenticationEligible: false,
        },
        select: { id: true },
      });
      const invitation = await transaction.invitation.create({
        data: {
          organizationId: input.actor.organizationId,
          employeeId: employee.id,
          userAccountId: account.id,
          invitedEmailNormalized: input.employee.workEmail,
          tokenHash: input.tokenHash,
          status: 'PENDING',
          issuerEmployeeId: input.actor.employeeId,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
        },
        select: invitationSelect,
      });

      await this.audit.append(
        {
          organizationId: invitation.organizationId,
          actionKey: AUDIT_ACTION_KEYS.invitationIssued,
          actorEmployeeId: input.actor.employeeId,
          actorSnapshot: actorSnapshot(issuer),
          targetType: 'invitation',
          targetId: invitation.id,
          targetSnapshot: targetSnapshot(employee),
          ...this.historyContext(),
          occurredAt: input.issuedAt,
        },
        transaction,
      );
      await this.security.append(
        {
          organizationId: invitation.organizationId,
          eventType: SECURITY_EVENT_TYPES.invitationIssued,
          category: 'invitation',
          risk: 'MEDIUM',
          outcome: 'succeeded',
          actorEmployeeId: input.actor.employeeId,
          actorAccountId: input.actor.userAccountId,
          actorSnapshot: actorSnapshot(issuer),
          safeContext: { status: 'PENDING' },
          ...this.historyContext(),
          occurredAt: input.issuedAt,
        },
        transaction,
      );
      await this.outbox(
        transaction,
        INVITATION_EVENT_CONTRACTS.employeeInvited,
        invitation.organizationId,
        {
          organizationId: invitation.organizationId,
          employeeId: invitation.employeeId,
          userAccountId: invitation.userAccountId,
          invitationId: invitation.id,
          issuedAt: invitation.issuedAt.toISOString(),
          expiresAt: invitation.expiresAt.toISOString(),
        },
        input.issuedAt,
      );
      return view(invitation);
    });
  }

  async list(organizationId: string, page: number, pageSize: number): Promise<InvitationPage> {
    const [total, invitations] = await this.client.$transaction([
      this.client.invitation.count({ where: { organizationId } }),
      this.client.invitation.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: invitationSelect,
      }),
    ]);
    return { items: invitations.map(view), page, pageSize, total };
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationView | null> {
    const invitation = await this.client.invitation.findUnique({
      where: { tokenHash },
      select: invitationSelect,
    });
    return invitation ? view(invitation) : null;
  }

  revoke(input: Parameters<InvitationRepositoryPort['revoke']>[0]): Promise<RevocationResult> {
    return runInTransaction(this.client, async (transaction) => {
      const locked = await this.lockInvitation(transaction, input.invitationId, input.actor.organizationId);
      if (!locked) return { status: 'not_found' };
      if (locked.status === 'REVOKED') {
        return { status: 'idempotent', invitation: view(locked) };
      }
      if (locked.status !== 'PENDING') return { status: 'conflict' };
      if (input.now.getTime() >= locked.expiresAt.getTime()) {
        await this.expireLocked(transaction, locked, input.now);
        return { status: 'conflict' };
      }

      const [revoker, target] = await Promise.all([
        transaction.employee.findFirstOrThrow({
          where: {
            id: input.actor.employeeId,
            organizationId: input.actor.organizationId,
          },
          select: { displayName: true, employeeCode: true },
        }),
        transaction.employee.findFirstOrThrow({
          where: {
            id: locked.employeeId,
            organizationId: locked.organizationId,
          },
          select: { displayName: true, employeeCode: true },
        }),
      ]);
      const updated = await transaction.invitation.update({
        where: { id: locked.id },
        data: {
          status: 'REVOKED',
          revokedAt: input.now,
          revokedByEmployeeId: input.actor.employeeId,
          ...(input.safeReason ? { safeRevocationReason: input.safeReason } : {}),
        },
        select: invitationSelect,
      });
      await this.audit.append(
        {
          organizationId: locked.organizationId,
          actionKey: AUDIT_ACTION_KEYS.invitationRevoked,
          actorEmployeeId: input.actor.employeeId,
          actorSnapshot: actorSnapshot(revoker),
          targetType: 'invitation',
          targetId: locked.id,
          targetSnapshot: targetSnapshot(target),
          ...(input.safeReason ? { safeReason: input.safeReason } : {}),
          ...this.historyContext(),
          occurredAt: input.now,
        },
        transaction,
      );
      await this.security.append(
        {
          organizationId: locked.organizationId,
          eventType: SECURITY_EVENT_TYPES.invitationRevoked,
          category: 'invitation',
          risk: 'MEDIUM',
          outcome: 'succeeded',
          actorEmployeeId: input.actor.employeeId,
          actorAccountId: input.actor.userAccountId,
          actorSnapshot: actorSnapshot(revoker),
          safeContext: { status: 'REVOKED' },
          ...this.historyContext(),
          occurredAt: input.now,
        },
        transaction,
      );
      await this.outbox(
        transaction,
        INVITATION_EVENT_CONTRACTS.invitationRevoked,
        locked.organizationId,
        this.terminalPayload(locked, input.now),
        input.now,
      );
      return { status: 'revoked', invitation: view(updated) };
    });
  }

  resend(input: Parameters<InvitationRepositoryPort['resend']>[0]): ReturnType<InvitationRepositoryPort['resend']> {
    return runInTransaction(this.client, async (transaction) => {
      const locked = await this.lockInvitation(transaction, input.invitationId, input.actor.organizationId);
      if (!locked) return { status: 'not_found' };
      if (locked.status === 'PENDING' && input.issuedAt.getTime() >= locked.expiresAt.getTime()) {
        await this.expireLocked(transaction, locked, input.issuedAt);
        return { status: 'conflict' };
      }
      if (locked.status !== 'PENDING') return { status: 'conflict' };

      const target = await this.lockInvitationTarget(transaction, locked.organizationId, locked.employeeId);
      if (!target || target.userAccountId !== locked.userAccountId || !this.isReissueEligible(target)) {
        return { status: 'conflict' };
      }

      const history = await this.lockInvitationsForTarget(transaction, target);
      for (const invitation of history) {
        if (invitation.id === locked.id || invitation.status !== 'PENDING') continue;
        if (input.issuedAt.getTime() < invitation.expiresAt.getTime()) {
          return { status: 'conflict' };
        }
        await this.expireLocked(transaction, invitation, input.issuedAt);
      }

      const invitation = await this.createReissuedInvitation(transaction, target, input);
      const superseded = await transaction.invitation.updateMany({
        where: {
          id: locked.id,
          organizationId: locked.organizationId,
          status: 'PENDING',
          expiresAt: { gt: input.issuedAt },
        },
        data: {
          status: 'SUPERSEDED',
          supersededAt: input.issuedAt,
          supersededByInvitationId: invitation.id,
        },
      });
      if (superseded.count !== 1) {
        throw new Error('Invitation supersession invariant failed');
      }
      const previousInvitation = await transaction.invitation.findUniqueOrThrow({
        where: { id: locked.id },
        select: invitationSelect,
      });
      await this.appendReissueHistory(transaction, input.actor, target, previousInvitation, invitation, 'RESEND');
      return {
        status: 'reissued',
        operation: 'RESEND',
        previousInvitation: view(previousInvitation),
        invitation: view(invitation),
      };
    });
  }

  reinvite(
    input: Parameters<InvitationRepositoryPort['reinvite']>[0],
  ): ReturnType<InvitationRepositoryPort['reinvite']> {
    return runInTransaction(this.client, async (transaction) => {
      const target = await this.lockInvitationTarget(transaction, input.actor.organizationId, input.employeeId);
      if (!target) return { status: 'not_found' };
      if (!this.isReissueEligible(target)) return { status: 'conflict' };

      const history = await this.lockInvitationsForTarget(transaction, target);
      if (history.length === 0 || history.some(({ status }) => status === 'ACCEPTED')) {
        return { status: 'conflict' };
      }
      for (const invitation of history) {
        if (invitation.status !== 'PENDING') continue;
        if (input.issuedAt.getTime() < invitation.expiresAt.getTime()) {
          return { status: 'conflict' };
        }
        await this.expireLocked(transaction, invitation, input.issuedAt);
      }

      const previousInvitation = await transaction.invitation.findUniqueOrThrow({
        where: { id: history[0]!.id },
        select: invitationSelect,
      });
      const invitation = await this.createReissuedInvitation(transaction, target, input);
      await this.appendReissueHistory(transaction, input.actor, target, previousInvitation, invitation, 'REINVITE');
      return {
        status: 'reissued',
        operation: 'REINVITE',
        previousInvitation: view(previousInvitation),
        invitation: view(invitation),
      };
    });
  }

  materializeExpired(input: Parameters<InvitationRepositoryPort['materializeExpired']>[0]): Promise<boolean> {
    return runInTransaction(this.client, async (transaction) => {
      const locked = await this.lockInvitation(transaction, input.invitationId);
      if (!locked || locked.status !== 'PENDING' || input.now.getTime() < locked.expiresAt.getTime()) {
        return false;
      }
      await this.expireLocked(transaction, locked, input.now);
      return true;
    });
  }

  async materializeExpiredForOrganization(
    input: Parameters<InvitationRepositoryPort['materializeExpiredForOrganization']>[0],
  ): Promise<number> {
    const candidates = await this.client.invitation.findMany({
      where: {
        organizationId: input.organizationId,
        status: 'PENDING',
        expiresAt: { lte: input.now },
      },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: input.limit,
      select: { id: true },
    });
    let materialized = 0;
    for (const candidate of candidates) {
      if (
        await this.materializeExpired({
          invitationId: candidate.id,
          now: input.now,
        })
      ) {
        materialized += 1;
      }
    }
    return materialized;
  }

  accept(input: Parameters<InvitationRepositoryPort['accept']>[0]): Promise<AcceptancePersistenceResult> {
    return runInTransaction(this.client, async (transaction) => {
      const locked = await this.lockInvitation(transaction, input.authorizationReference);
      if (!locked || locked.status !== 'PENDING') {
        return { status: 'denied', failureCategory: 'invitation_ineligible' };
      }
      if (input.now.getTime() >= locked.expiresAt.getTime()) {
        await this.expireLocked(transaction, locked, input.now);
        return {
          status: 'denied',
          failureCategory: 'invitation_ineligible',
          organizationId: locked.organizationId,
        };
      }
      if (input.organizationId !== locked.organizationId) {
        return {
          status: 'denied',
          failureCategory: 'organization_mismatch',
          organizationId: locked.organizationId,
        };
      }
      if (
        input.identity.emailVerificationStatus !== 'verified' ||
        !input.identity.verifiedEmail ||
        input.identity.verifiedEmail.trim().toLowerCase() !== locked.invitedEmailNormalized
      ) {
        return {
          status: 'denied',
          failureCategory: 'identity_mismatch',
          organizationId: locked.organizationId,
        };
      }

      const [employee, account, existingIdentity] = await Promise.all([
        transaction.employee.findFirst({
          where: {
            id: locked.employeeId,
            organizationId: locked.organizationId,
          },
          select: {
            id: true,
            organizationId: true,
            lifecycleStatus: true,
            activatedAt: true,
            displayName: true,
            employeeCode: true,
          },
        }),
        transaction.userAccount.findFirst({
          where: {
            id: locked.userAccountId,
            organizationId: locked.organizationId,
          },
          select: {
            id: true,
            organizationId: true,
            employeeId: true,
            authenticationEligible: true,
            activatedAt: true,
            disabledAt: true,
          },
        }),
        transaction.sSOIdentity.findUnique({
          where: {
            providerKey_providerSubject: {
              providerKey: input.identity.providerKey.trim().toLowerCase(),
              providerSubject: input.identity.providerSubject.trim(),
            },
          },
          select: { id: true },
        }),
      ]);
      if (
        !employee ||
        !account ||
        employee.organizationId !== locked.organizationId ||
        account.organizationId !== locked.organizationId ||
        account.employeeId !== employee.id ||
        employee.lifecycleStatus !== 'INVITED' ||
        employee.activatedAt !== null ||
        account.authenticationEligible ||
        account.activatedAt !== null ||
        account.disabledAt !== null
      ) {
        return {
          status: 'denied',
          failureCategory: 'invitation_ineligible',
          organizationId: locked.organizationId,
        };
      }
      if (existingIdentity) {
        return {
          status: 'denied',
          failureCategory: 'identity_linked',
          organizationId: locked.organizationId,
        };
      }

      const consumed = await transaction.invitation.updateMany({
        where: {
          id: locked.id,
          status: 'PENDING',
          expiresAt: { gt: input.now },
        },
        data: {
          status: 'ACCEPTED',
          acceptedAt: input.now,
          onboardingCompletedAt: input.now,
        },
      });
      if (consumed.count !== 1) {
        return {
          status: 'denied',
          failureCategory: 'invitation_ineligible',
          organizationId: locked.organizationId,
        };
      }
      const ssoIdentity = await transaction.sSOIdentity.create({
        data: {
          organizationId: locked.organizationId,
          userAccountId: locked.userAccountId,
          providerKey: input.identity.providerKey.trim().toLowerCase(),
          providerSubject: input.identity.providerSubject.trim(),
          verifiedEmailNormalized: locked.invitedEmailNormalized,
          linkedAt: input.now,
          lastAuthenticatedAt: input.identity.authenticatedAt ?? input.now,
        },
        select: { id: true, providerKey: true },
      });
      const activatedAccount = await transaction.userAccount.updateMany({
        where: {
          id: locked.userAccountId,
          organizationId: locked.organizationId,
          employeeId: locked.employeeId,
          authenticationEligible: false,
          activatedAt: null,
          disabledAt: null,
        },
        data: { authenticationEligible: true, activatedAt: input.now },
      });
      if (activatedAccount.count !== 1) throw new Error('Account activation invariant failed');
      const activatedEmployee = await transaction.employee.updateMany({
        where: {
          id: locked.employeeId,
          organizationId: locked.organizationId,
          lifecycleStatus: 'INVITED',
          activatedAt: null,
        },
        data: { lifecycleStatus: 'ACTIVE', activatedAt: input.now },
      });
      if (activatedEmployee.count !== 1) throw new Error('Employee activation invariant failed');

      const snapshot = actorSnapshot(employee);
      for (const auditEntry of [
        {
          actionKey: AUDIT_ACTION_KEYS.invitationAccepted,
          targetType: 'invitation',
          targetId: locked.id,
        },
        {
          actionKey: AUDIT_ACTION_KEYS.onboardingCompleted,
          targetType: 'employee',
          targetId: locked.employeeId,
        },
      ] as const) {
        await this.audit.append(
          {
            organizationId: locked.organizationId,
            actionKey: auditEntry.actionKey,
            actorEmployeeId: locked.employeeId,
            actorSnapshot: snapshot,
            targetType: auditEntry.targetType,
            targetId: auditEntry.targetId,
            targetSnapshot: targetSnapshot(employee),
            ...this.historyContext(),
            occurredAt: input.now,
          },
          transaction,
        );
      }
      for (const eventType of [
        SECURITY_EVENT_TYPES.invitationAccepted,
        SECURITY_EVENT_TYPES.onboardingCompleted,
      ] as const) {
        await this.security.append(
          {
            organizationId: locked.organizationId,
            eventType,
            category: eventType === SECURITY_EVENT_TYPES.invitationAccepted ? 'invitation' : 'onboarding',
            risk: 'MEDIUM',
            outcome: 'succeeded',
            actorEmployeeId: locked.employeeId,
            actorAccountId: locked.userAccountId,
            providerKey: ssoIdentity.providerKey,
            actorSnapshot: snapshot,
            safeContext: { status: 'ACTIVE' },
            ...this.historyContext(),
            occurredAt: input.now,
          },
          transaction,
        );
      }
      await this.outbox(
        transaction,
        INVITATION_EVENT_CONTRACTS.invitationAccepted,
        locked.organizationId,
        this.terminalPayload(locked, input.now),
        input.now,
      );
      await this.outbox(
        transaction,
        IDENTITY_EVENT_CONTRACTS.ssoIdentityLinked,
        locked.organizationId,
        {
          organizationId: locked.organizationId,
          employeeId: locked.employeeId,
          userAccountId: locked.userAccountId,
          ssoIdentityId: ssoIdentity.id,
          providerKey: ssoIdentity.providerKey,
        },
        input.now,
      );
      await this.outbox(
        transaction,
        INVITATION_EVENT_CONTRACTS.onboardingCompleted,
        locked.organizationId,
        {
          ...this.terminalPayload(locked, input.now),
          ssoIdentityId: ssoIdentity.id,
          providerKey: ssoIdentity.providerKey,
        },
        input.now,
      );
      return {
        status: 'accepted',
        providerKey: ssoIdentity.providerKey,
        organizationId: locked.organizationId,
        employeeId: locked.employeeId,
        userAccountId: locked.userAccountId,
      };
    });
  }

  async recordAcceptanceFailure(
    input: Parameters<InvitationRepositoryPort['recordAcceptanceFailure']>[0],
  ): Promise<void> {
    try {
      await this.security.append({
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        eventType: SECURITY_EVENT_TYPES.invitationAcceptanceFailed,
        category: 'onboarding',
        risk: 'MEDIUM',
        outcome: 'failed',
        safeContext: { failureCategory: input.failureCategory },
        ...this.historyContext(),
        occurredAt: input.occurredAt,
      });
    } catch {
      this.logger.errorEvent('identity.onboarding.security_event_failed', {
        outcome: 'failed',
        failureCategory: input.failureCategory,
      });
    }
  }

  private async expireLocked(
    transaction: DatabaseTransaction,
    invitation: LockedInvitation,
    materializedAt: Date,
  ): Promise<void> {
    const target = await transaction.employee.findFirstOrThrow({
      where: {
        id: invitation.employeeId,
        organizationId: invitation.organizationId,
      },
      select: { displayName: true, employeeCode: true },
    });
    const updated = await transaction.invitation.updateMany({
      where: {
        id: invitation.id,
        status: 'PENDING',
        expiresAt: { lte: materializedAt },
      },
      data: { status: 'EXPIRED' },
    });
    if (updated.count !== 1) return;
    await this.audit.append(
      {
        organizationId: invitation.organizationId,
        actionKey: AUDIT_ACTION_KEYS.invitationExpired,
        actorSnapshot: { type: 'system' },
        targetType: 'invitation',
        targetId: invitation.id,
        targetSnapshot: targetSnapshot(target),
        ...this.historyContext(),
        occurredAt: materializedAt,
      },
      transaction,
    );
    await this.security.append(
      {
        organizationId: invitation.organizationId,
        eventType: SECURITY_EVENT_TYPES.invitationExpired,
        category: 'invitation',
        risk: 'LOW',
        outcome: 'materialized',
        actorSnapshot: { type: 'system' },
        safeContext: { status: 'EXPIRED' },
        ...this.historyContext(),
        occurredAt: materializedAt,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      INVITATION_EVENT_CONTRACTS.invitationExpired,
      invitation.organizationId,
      {
        ...this.terminalPayload(invitation, materializedAt),
        expiresAt: invitation.expiresAt.toISOString(),
      },
      materializedAt,
    );
  }

  private async lockInvitation(
    transaction: DatabaseTransaction,
    invitationId: string,
    organizationId?: string,
  ): Promise<LockedInvitation | null> {
    const reference = await transaction.invitation.findFirst({
      where: {
        id: invitationId,
        ...(organizationId ? { organizationId } : {}),
      },
      select: { organizationId: true, employeeId: true, userAccountId: true },
    });
    if (!reference) return null;
    const target = await this.lockInvitationTarget(transaction, reference.organizationId, reference.employeeId);
    if (!target || target.userAccountId !== reference.userAccountId) return null;
    const rows = await transaction.$queryRaw<LockedInvitation[]>(Prisma.sql`
      SELECT
        "id", "organization_id" AS "organizationId", "employee_id" AS "employeeId",
        "user_account_id" AS "userAccountId",
        "invited_email_normalized" AS "invitedEmailNormalized", "status",
        "issuer_employee_id" AS "issuerEmployeeId", "issued_at" AS "issuedAt",
        "expires_at" AS "expiresAt", "accepted_at" AS "acceptedAt",
        "revoked_at" AS "revokedAt", "revoked_by_employee_id" AS "revokedByEmployeeId",
        "safe_revocation_reason" AS "safeRevocationReason",
        "superseded_at" AS "supersededAt",
        "superseded_by_invitation_id" AS "supersededByInvitationId",
        "onboarding_completed_at" AS "onboardingCompletedAt",
        "created_at" AS "createdAt", "updated_at" AS "updatedAt"
      FROM "invitations"
      WHERE "id" = ${invitationId}::uuid
        AND "organization_id" = ${reference.organizationId}::uuid
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockInvitationTarget(
    transaction: DatabaseTransaction,
    organizationId: string,
    employeeId: string,
  ): Promise<LockedInvitationTarget | null> {
    const rows = await transaction.$queryRaw<LockedInvitationTarget[]>(Prisma.sql`
      SELECT
        employee."organization_id" AS "organizationId",
        employee."id" AS "employeeId",
        employee."employee_code" AS "employeeCode",
        employee."display_name" AS "displayName",
        employee."work_email" AS "workEmail",
        employee."lifecycle_status" AS "lifecycleStatus",
        employee."activated_at" AS "employeeActivatedAt",
        account."id" AS "userAccountId",
        account."employee_id" AS "accountEmployeeId",
        account."authentication_eligible" AS "authenticationEligible",
        account."activated_at" AS "accountActivatedAt",
        account."disabled_at" AS "disabledAt"
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

  private lockInvitationsForTarget(
    transaction: DatabaseTransaction,
    target: LockedInvitationTarget,
  ): Promise<LockedInvitation[]> {
    return transaction.$queryRaw<LockedInvitation[]>(Prisma.sql`
      SELECT
        "id", "organization_id" AS "organizationId", "employee_id" AS "employeeId",
        "user_account_id" AS "userAccountId",
        "invited_email_normalized" AS "invitedEmailNormalized", "status",
        "issuer_employee_id" AS "issuerEmployeeId", "issued_at" AS "issuedAt",
        "expires_at" AS "expiresAt", "accepted_at" AS "acceptedAt",
        "revoked_at" AS "revokedAt", "revoked_by_employee_id" AS "revokedByEmployeeId",
        "safe_revocation_reason" AS "safeRevocationReason",
        "superseded_at" AS "supersededAt",
        "superseded_by_invitation_id" AS "supersededByInvitationId",
        "onboarding_completed_at" AS "onboardingCompletedAt",
        "created_at" AS "createdAt", "updated_at" AS "updatedAt"
      FROM "invitations"
      WHERE "organization_id" = ${target.organizationId}::uuid
        AND "employee_id" = ${target.employeeId}::uuid
        AND "user_account_id" = ${target.userAccountId}::uuid
      ORDER BY "issued_at" DESC, "created_at" DESC, "id" DESC
      FOR UPDATE
    `);
  }

  private isReissueEligible(target: LockedInvitationTarget): boolean {
    return (
      target.accountEmployeeId === target.employeeId &&
      target.lifecycleStatus === 'INVITED' &&
      target.employeeActivatedAt === null &&
      !target.authenticationEligible &&
      target.accountActivatedAt === null &&
      target.disabledAt === null
    );
  }

  private createReissuedInvitation(
    transaction: DatabaseTransaction,
    target: LockedInvitationTarget,
    input: Parameters<InvitationRepositoryPort['resend']>[0] | Parameters<InvitationRepositoryPort['reinvite']>[0],
  ): Promise<RawInvitation> {
    return transaction.invitation.create({
      data: {
        organizationId: target.organizationId,
        employeeId: target.employeeId,
        userAccountId: target.userAccountId,
        invitedEmailNormalized: target.workEmail,
        tokenHash: input.tokenHash,
        status: 'PENDING',
        issuerEmployeeId: input.actor.employeeId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
      },
      select: invitationSelect,
    });
  }

  private async appendReissueHistory(
    transaction: DatabaseTransaction,
    actor: Parameters<InvitationRepositoryPort['resend']>[0]['actor'],
    target: LockedInvitationTarget,
    previousInvitation: RawInvitation,
    invitation: RawInvitation,
    operation: 'RESEND' | 'REINVITE',
  ): Promise<void> {
    const issuer = await transaction.employee.findFirstOrThrow({
      where: { id: actor.employeeId, organizationId: actor.organizationId },
      select: { displayName: true, employeeCode: true },
    });
    const safeLink = `${operation} outcome succeeded previous ${previousInvitation.id} replacement ${invitation.id}`;
    if (operation === 'RESEND') {
      await this.audit.append(
        {
          organizationId: target.organizationId,
          actionKey: AUDIT_ACTION_KEYS.invitationSuperseded,
          actorEmployeeId: actor.employeeId,
          actorSnapshot: actorSnapshot(issuer),
          targetType: 'invitation',
          targetId: previousInvitation.id,
          targetSnapshot: targetSnapshot(target),
          safeReason: safeLink,
          ...this.historyContext(),
          occurredAt: invitation.issuedAt,
        },
        transaction,
      );
      await this.security.append(
        {
          organizationId: target.organizationId,
          eventType: SECURITY_EVENT_TYPES.invitationSuperseded,
          category: 'invitation',
          risk: 'MEDIUM',
          outcome: 'succeeded',
          actorEmployeeId: actor.employeeId,
          actorAccountId: actor.userAccountId,
          actorSnapshot: actorSnapshot(issuer),
          safeContext: {
            operation,
            previousInvitationId: previousInvitation.id,
            newInvitationId: invitation.id,
            previousStatus: 'PENDING',
            status: 'SUPERSEDED',
          },
          ...this.historyContext(),
          occurredAt: invitation.issuedAt,
        },
        transaction,
      );
      await this.outbox(
        transaction,
        INVITATION_EVENT_CONTRACTS.invitationSuperseded,
        target.organizationId,
        {
          ...this.terminalPayload(previousInvitation, invitation.issuedAt),
          supersededByInvitationId: invitation.id,
          fromStatus: 'PENDING',
          toStatus: 'SUPERSEDED',
        },
        invitation.issuedAt,
      );
    }

    await this.audit.append(
      {
        organizationId: target.organizationId,
        actionKey: AUDIT_ACTION_KEYS.invitationReissued,
        actorEmployeeId: actor.employeeId,
        actorSnapshot: actorSnapshot(issuer),
        targetType: 'invitation',
        targetId: invitation.id,
        targetSnapshot: targetSnapshot(target),
        safeReason: safeLink,
        ...this.historyContext(),
        occurredAt: invitation.issuedAt,
      },
      transaction,
    );
    await this.security.append(
      {
        organizationId: target.organizationId,
        eventType: SECURITY_EVENT_TYPES.invitationReissued,
        category: 'invitation',
        risk: 'MEDIUM',
        outcome: 'succeeded',
        actorEmployeeId: actor.employeeId,
        actorAccountId: actor.userAccountId,
        actorSnapshot: actorSnapshot(issuer),
        safeContext: {
          operation,
          previousInvitationId: previousInvitation.id,
          newInvitationId: invitation.id,
          previousStatus: previousInvitation.status,
          status: 'PENDING',
        },
        ...this.historyContext(),
        occurredAt: invitation.issuedAt,
      },
      transaction,
    );
    await this.outbox(
      transaction,
      INVITATION_EVENT_CONTRACTS.invitationReissued,
      target.organizationId,
      {
        organizationId: target.organizationId,
        employeeId: target.employeeId,
        userAccountId: target.userAccountId,
        previousInvitationId: previousInvitation.id,
        invitationId: invitation.id,
        operation,
        status: 'PENDING',
        issuedAt: invitation.issuedAt.toISOString(),
        expiresAt: invitation.expiresAt.toISOString(),
      },
      invitation.issuedAt,
    );
  }

  private historyContext(): {
    readonly requestId?: string;
    readonly correlationId: string;
  } {
    const context = this.contextStore.get();
    return {
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      correlationId: context?.correlationId ?? randomUUID(),
    };
  }

  private terminalPayload(invitation: LockedInvitation, occurredAt: Date) {
    return {
      organizationId: invitation.organizationId,
      employeeId: invitation.employeeId,
      userAccountId: invitation.userAccountId,
      invitationId: invitation.id,
      occurredAt: occurredAt.toISOString(),
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
