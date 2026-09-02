import { Inject, Injectable } from '@nestjs/common';
import type { InvitationConfig } from '@dar-tech/config';
import {
  ApplicationError,
  STRUCTURED_LOGGER,
  type StructuredLogger,
} from '@dar-tech/observability';
import { AuthenticationService } from '../auth/auth.service.js';
import {
  authenticationRequired,
  authorizationDenied,
} from '../identity/identity.errors.js';
import {
  INVITATION_ACTIONS,
  INVITATION_ACTOR_PORT,
  INVITATION_AUTHORIZATION_PORT,
  INVITATION_CLOCK,
  INVITATION_CONFIG,
  INVITATION_REPOSITORY_PORT,
  INVITATION_SECRET_GENERATOR,
  type InvitationAcceptanceResult,
  type InvitationActor,
  type InvitationActorPort,
  type InvitationAuthorizationPort,
  type InvitationClock,
  type InvitationInspection,
  type InvitationPage,
  type InvitationRepositoryPort,
  type InvitationSecretGenerator,
  type InvitationView,
  type IssuedInvitation,
} from './invitation.contracts.js';
import {
  invalidInvitationSecret,
  invitationIssuanceConflict,
  invitationNotFound,
  invitationStateConflict,
  onboardingFailed,
} from './invitation.errors.js';
import {
  parseInvitationId,
  parseInvitationPagination,
  parseInvitationSecretBody,
  parseInviteEmployee,
  parseOnboardingStart,
  parseRevocation,
} from './invitation-input.js';

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
@Injectable()
export class InvitationService {
  constructor(
    @Inject(INVITATION_CONFIG) private readonly config: InvitationConfig,
    @Inject(INVITATION_ACTOR_PORT) private readonly actors: InvitationActorPort,
    @Inject(INVITATION_AUTHORIZATION_PORT)
    private readonly authorization: InvitationAuthorizationPort,
    @Inject(INVITATION_REPOSITORY_PORT) private readonly repository: InvitationRepositoryPort,
    @Inject(INVITATION_SECRET_GENERATOR)
    private readonly secrets: InvitationSecretGenerator,
    @Inject(INVITATION_CLOCK) private readonly clock: InvitationClock,
    @Inject(AuthenticationService) private readonly authentication: AuthenticationService,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async invite(input: unknown): Promise<IssuedInvitation> {
    const actor = await this.requireActor();
    await this.requireAuthorization(actor, INVITATION_ACTIONS.inviteEmployee);
    const employee = parseInviteEmployee(input);
    const secret = this.secrets.generate();
    const issuedAt = this.clock.now();
    const expiresAt = new Date(issuedAt.getTime() + this.config.ttlSeconds * 1_000);
    try {
      const invitation = await this.repository.issue({
        actor,
        employee,
        tokenHash: secret.hash,
        issuedAt,
        expiresAt,
      });
      this.logger.info('identity.invitation.issued', {
        outcome: 'succeeded',
        organizationId: actor.organizationId,
        invitationId: invitation.id,
      });
      return {
        invitation,
        acceptanceUrl: `/onboarding#invite=${secret.secret}`,
      };
    } catch (error) {
      this.logFailure('issue', actor.organizationId, error);
      if (hasErrorCode(error, 'P2002')) throw invitationIssuanceConflict();
      throw error;
    }
  }

  async list(pageInput?: string, pageSizeInput?: string): Promise<InvitationPage> {
    const actor = await this.requireActor();
    await this.requireAuthorization(actor, INVITATION_ACTIONS.readInvitation);
    const { page, pageSize } = parseInvitationPagination(pageInput, pageSizeInput);
    await this.repository.materializeExpiredForOrganization({
      organizationId: actor.organizationId,
      now: this.clock.now(),
      limit: 100,
    });
    return this.repository.list(actor.organizationId, page, pageSize);
  }

  async revoke(invitationIdInput: string, input: unknown): Promise<InvitationView> {
    const actor = await this.requireActor();
    const invitationId = parseInvitationId(invitationIdInput);
    await this.requireAuthorization(actor, INVITATION_ACTIONS.revokeInvitation, invitationId);
    const parsed = parseRevocation(input);
    const result = await this.repository.revoke({
      actor,
      invitationId,
      ...parsed,
      now: this.clock.now(),
    });
    if (result.status === 'not_found') throw invitationNotFound();
    if (result.status === 'conflict') throw invitationStateConflict();
    this.logger.info('identity.invitation.revoked', {
      outcome: result.status === 'revoked' ? 'succeeded' : 'idempotent',
      organizationId: actor.organizationId,
      invitationId,
    });
    return result.invitation;
  }

  async inspect(input: unknown): Promise<InvitationInspection> {
    const token = parseInvitationSecretBody(input);
    let hash: string;
    try {
      hash = this.secrets.hash(token);
    } catch (error) {
      await this.repository.recordAcceptanceFailure({
        failureCategory: 'unknown_invitation',
        occurredAt: this.clock.now(),
      });
      throw error;
    }
    const invitation = await this.repository.findByTokenHash(hash);
    if (!invitation) {
      await this.repository.recordAcceptanceFailure({
        failureCategory: 'unknown_invitation',
        occurredAt: this.clock.now(),
      });
      throw invalidInvitationSecret();
    }
    const now = this.clock.now();
    if (now.getTime() >= invitation.expiresAt.getTime()) {
      await this.materializeExpiredSafely(invitation.id, now);
      return { status: 'EXPIRED', expiresAt: invitation.expiresAt };
    }
    if (invitation.status === 'REVOKED') {
      return { status: 'REVOKED', expiresAt: invitation.expiresAt };
    }
    if (invitation.status === 'ACCEPTED') {
      return { status: 'ALREADY_USED', expiresAt: invitation.expiresAt };
    }
    if (invitation.status === 'EXPIRED') {
      return { status: 'EXPIRED', expiresAt: invitation.expiresAt };
    }
    return { status: 'VALID', expiresAt: invitation.expiresAt };
  }

  async startAuthentication(providerKey: string, input: unknown) {
    const parsed = parseOnboardingStart(input);
    const invitation = await this.requirePendingInvitation(parsed.invitationToken);
    return this.authentication.startForInvitation(
      providerKey,
      parsed.authenticationInput,
      invitation.id,
    );
  }

  async completeAuthentication(
    providerKey: string,
    input: unknown,
  ): Promise<InvitationAcceptanceResult> {
    let outcome;
    try {
      outcome = await this.authentication.verify(providerKey, input);
    } catch {
      throw onboardingFailed();
    }
    if (outcome.principal.kind !== 'invitation_authorized') {
      await this.repository.recordAcceptanceFailure({
        organizationId: outcome.principal.organizationId,
        failureCategory: 'identity_linked',
        occurredAt: this.clock.now(),
      });
      throw onboardingFailed();
    }
    try {
      const accepted = await this.repository.accept({
        authorizationReference: outcome.principal.authorizationReference,
        organizationId: outcome.principal.organizationId,
        identity: outcome.identity,
        now: this.clock.now(),
      });
      if (accepted.status === 'denied') {
        await this.repository.recordAcceptanceFailure({
          ...(accepted.organizationId
            ? { organizationId: accepted.organizationId }
            : {}),
          failureCategory: accepted.failureCategory,
          occurredAt: this.clock.now(),
        });
        throw onboardingFailed();
      }
      this.logger.info('identity.onboarding.completed', {
        outcome: 'succeeded',
        organizationId: outcome.principal.organizationId,
        providerKey: accepted.providerKey,
      });
      return {
        status: 'ONBOARDING_COMPLETED',
        providerKey: accepted.providerKey,
        sessionCreated: false,
        nextStep: 'SESSION_ISSUANCE_DEFERRED',
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      await this.repository.recordAcceptanceFailure({
        organizationId: outcome.principal.organizationId,
        failureCategory: hasErrorCode(error, 'P2002')
          ? 'identity_linked'
          : 'transaction_failed',
        occurredAt: this.clock.now(),
      });
      this.logFailure('accept', outcome.principal.organizationId, error);
      throw onboardingFailed();
    }
  }

  private async requirePendingInvitation(token: string): Promise<InvitationView> {
    let hash: string;
    try {
      hash = this.secrets.hash(token);
    } catch {
      await this.repository.recordAcceptanceFailure({
        failureCategory: 'unknown_invitation',
        occurredAt: this.clock.now(),
      });
      throw onboardingFailed();
    }
    const invitation = await this.repository.findByTokenHash(hash);
    const now = this.clock.now();
    if (!invitation) {
      await this.repository.recordAcceptanceFailure({
        failureCategory: 'unknown_invitation',
        occurredAt: now,
      });
      throw onboardingFailed();
    }
    if (now.getTime() >= invitation.expiresAt.getTime()) {
      await this.materializeExpiredSafely(invitation.id, now);
      await this.repository.recordAcceptanceFailure({
        organizationId: invitation.organizationId,
        failureCategory: 'expired_invitation',
        occurredAt: now,
      });
      throw onboardingFailed();
    }
    if (invitation.status !== 'PENDING') {
      await this.repository.recordAcceptanceFailure({
        organizationId: invitation.organizationId,
        failureCategory: 'invitation_ineligible',
        occurredAt: now,
      });
      throw onboardingFailed();
    }
    return invitation;
  }

  private async materializeExpiredSafely(invitationId: string, now: Date): Promise<void> {
    try {
      await this.repository.materializeExpired({ invitationId, now });
    } catch {
      this.logger.errorEvent('identity.invitation.expiry_materialization_failed', {
        outcome: 'failed',
      });
    }
  }

  private async requireActor(): Promise<InvitationActor> {
    const actor = await this.actors.currentActor();
    if (!actor) throw authenticationRequired();
    return actor;
  }

  private async requireAuthorization(
    actor: InvitationActor,
    action: (typeof INVITATION_ACTIONS)[keyof typeof INVITATION_ACTIONS],
    id?: string,
  ): Promise<void> {
    const allowed = await this.authorization.authorize({
      actor,
      action,
      resource: {
        type: 'employee-invitation',
        organizationId: actor.organizationId,
        ...(id ? { id } : {}),
      },
    });
    if (!allowed) throw authorizationDenied();
  }

  private logFailure(operation: string, organizationId: string, error: unknown): void {
    this.logger.warnEvent('identity.invitation.command_failed', {
      operation,
      organizationId,
      errorCategory: error instanceof Error ? error.name : 'unknown',
    });
  }
}
