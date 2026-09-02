import { IDENTITY_EVENT_CONTRACTS } from '../identity/identity.events.js';

export const INVITATION_EVENT_CONTRACTS = {
  employeeInvited: {
    name: 'EmployeeInvited.v1',
    eventType: 'identity.employee-invited',
    eventVersion: 1,
  },
  invitationAccepted: {
    name: 'InvitationAccepted.v1',
    eventType: 'identity.invitation-accepted',
    eventVersion: 1,
  },
  invitationRevoked: {
    name: 'InvitationRevoked.v1',
    eventType: 'identity.invitation-revoked',
    eventVersion: 1,
  },
  invitationExpired: {
    name: 'InvitationExpired.v1',
    eventType: 'identity.invitation-expired',
    eventVersion: 1,
  },
  invitationSuperseded: {
    name: 'InvitationSuperseded.v1',
    eventType: 'identity.invitation-superseded',
    eventVersion: 1,
  },
  invitationReissued: {
    name: 'InvitationReissued.v1',
    eventType: 'identity.invitation-reissued',
    eventVersion: 1,
  },
  onboardingCompleted: {
    name: 'OnboardingCompleted.v1',
    eventType: 'identity.onboarding-completed',
    eventVersion: 1,
  },
  ssoIdentityLinked: IDENTITY_EVENT_CONTRACTS.ssoIdentityLinked,
} as const;

export interface EmployeeInvitedV1Payload {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly invitationId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}
export interface InvitationTerminalV1Payload {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly invitationId: string;
  readonly occurredAt: string;
}

export interface InvitationExpiredV1Payload extends InvitationTerminalV1Payload {
  readonly expiresAt: string;
}

export interface OnboardingCompletedV1Payload extends InvitationTerminalV1Payload {
  readonly ssoIdentityId: string;
  readonly providerKey: string;
}

export interface InvitationSupersededV1Payload extends InvitationTerminalV1Payload {
  readonly supersededByInvitationId: string;
  readonly fromStatus: 'PENDING';
  readonly toStatus: 'SUPERSEDED';
}

export interface InvitationReissuedV1Payload {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly previousInvitationId: string;
  readonly invitationId: string;
  readonly operation: 'RESEND' | 'REINVITE';
  readonly status: 'PENDING';
  readonly issuedAt: string;
  readonly expiresAt: string;
}
