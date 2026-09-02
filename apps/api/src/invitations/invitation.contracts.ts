import type { DatabaseTransaction } from '@dar-tech/database';
import type { NormalizedProviderIdentity } from '../auth/auth.contracts.js';

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED', 'SUPERSEDED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_ACTIONS = {
  inviteEmployee: 'admin.employee.invite',
  readInvitation: 'admin.invitation.read',
  revokeInvitation: 'admin.invitation.revoke',
  resendInvitation: 'admin.invitation.resend',
} as const;
export type InvitationAction = (typeof INVITATION_ACTIONS)[keyof typeof INVITATION_ACTIONS];

export interface InvitationActor {
  readonly actorType: 'employee';
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
}

export interface InvitationActorPort {
  currentActor(): Promise<InvitationActor | null>;
}

export interface InvitationAuthorizationPort {
  authorize(request: {
    readonly actor: InvitationActor;
    readonly action: InvitationAction;
    readonly resource: {
      readonly type: 'employee-invitation';
      readonly organizationId: string;
      readonly id?: string;
    };
  }): Promise<boolean>;
}

export interface InvitationClock {
  now(): Date;
}

export interface InvitationSecretMaterial {
  readonly secret: string;
  readonly hash: string;
}

export interface InvitationSecretGenerator {
  generate(): InvitationSecretMaterial;
  hash(secret: string): string;
}

export interface InviteEmployeeInput {
  readonly employeeCode: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string;
  readonly workEmail: string;
}

export interface InvitationView {
  readonly id: string;
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly invitedEmailNormalized: string;
  readonly status: InvitationStatus;
  readonly issuerEmployeeId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokedByEmployeeId: string | null;
  readonly safeRevocationReason: string | null;
  readonly supersededAt: Date | null;
  readonly supersededByInvitationId: string | null;
  readonly onboardingCompletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface InvitationPage {
  readonly items: readonly InvitationView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface IssuedInvitation {
  readonly invitation: InvitationView;
  readonly acceptanceUrl: string;
}

export type InvitationInspection =
  | { readonly status: 'VALID'; readonly expiresAt: Date }
  | { readonly status: 'EXPIRED'; readonly expiresAt: Date }
  | { readonly status: 'REVOKED'; readonly expiresAt: Date }
  | { readonly status: 'SUPERSEDED'; readonly expiresAt: Date }
  | { readonly status: 'ALREADY_USED'; readonly expiresAt: Date };

export interface InvitationAcceptanceResult {
  readonly status: 'ONBOARDING_COMPLETED';
  readonly providerKey: string;
  readonly sessionCreated: false;
  readonly nextStep: 'SESSION_ISSUANCE_DEFERRED';
}

export type RevocationResult =
  | { readonly status: 'revoked'; readonly invitation: InvitationView }
  | { readonly status: 'idempotent'; readonly invitation: InvitationView }
  | { readonly status: 'not_found' }
  | { readonly status: 'conflict' };

export type InvitationReissueOperation = 'RESEND' | 'REINVITE';

export type ReissueResult =
  | {
      readonly status: 'reissued';
      readonly operation: InvitationReissueOperation;
      readonly previousInvitation: InvitationView;
      readonly invitation: InvitationView;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'conflict' };

export type AcceptancePersistenceResult =
  | { readonly status: 'accepted'; readonly providerKey: string }
  | {
      readonly status: 'denied';
      readonly failureCategory:
        'invitation_ineligible' | 'identity_mismatch' | 'identity_linked' | 'organization_mismatch';
      readonly organizationId?: string;
    };

export interface InvitationRepositoryPort {
  issue(input: {
    readonly actor: InvitationActor;
    readonly employee: InviteEmployeeInput;
    readonly tokenHash: string;
    readonly issuedAt: Date;
    readonly expiresAt: Date;
  }): Promise<InvitationView>;
  list(organizationId: string, page: number, pageSize: number): Promise<InvitationPage>;
  findByTokenHash(tokenHash: string): Promise<InvitationView | null>;
  revoke(input: {
    readonly actor: InvitationActor;
    readonly invitationId: string;
    readonly safeReason?: string;
    readonly now: Date;
  }): Promise<RevocationResult>;
  resend(input: {
    readonly actor: InvitationActor;
    readonly invitationId: string;
    readonly tokenHash: string;
    readonly issuedAt: Date;
    readonly expiresAt: Date;
  }): Promise<ReissueResult>;
  reinvite(input: {
    readonly actor: InvitationActor;
    readonly employeeId: string;
    readonly tokenHash: string;
    readonly issuedAt: Date;
    readonly expiresAt: Date;
  }): Promise<ReissueResult>;
  materializeExpired(input: { readonly invitationId: string; readonly now: Date }): Promise<boolean>;
  materializeExpiredForOrganization(input: {
    readonly organizationId: string;
    readonly now: Date;
    readonly limit: number;
  }): Promise<number>;
  accept(input: {
    readonly authorizationReference: string;
    readonly organizationId: string;
    readonly identity: NormalizedProviderIdentity;
    readonly now: Date;
  }): Promise<AcceptancePersistenceResult>;
  recordAcceptanceFailure(input: {
    readonly organizationId?: string;
    readonly failureCategory: string;
    readonly occurredAt: Date;
  }): Promise<void>;
}

export interface InvitationTransactionFailureHooks {
  beforeAudit?(stage: string, transaction: DatabaseTransaction): Promise<void>;
}

export const INVITATION_ACTOR_PORT = Symbol('INVITATION_ACTOR_PORT');
export const INVITATION_AUTHORIZATION_PORT = Symbol('INVITATION_AUTHORIZATION_PORT');
export const INVITATION_CLOCK = Symbol('INVITATION_CLOCK');
export const INVITATION_SECRET_GENERATOR = Symbol('INVITATION_SECRET_GENERATOR');
export const INVITATION_REPOSITORY_PORT = Symbol('INVITATION_REPOSITORY_PORT');
export const INVITATION_CONFIG = Symbol('INVITATION_CONFIG');
