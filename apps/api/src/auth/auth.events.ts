import {
  IDENTITY_EVENT_CONTRACTS,
  type SSOIdentityLinkedV1Payload,
} from '../identity/identity.events.js';

export const AUTHENTICATION_EVENT_CONTRACTS = {
  authenticationSucceeded: {
    name: 'AuthenticationSucceeded.v1',
    eventType: 'identity.authentication-succeeded',
    eventVersion: 1,
  },
  authenticationFailed: {
    name: 'AuthenticationFailed.v1',
    eventType: 'identity.authentication-failed',
    eventVersion: 1,
  },
  ssoIdentityLinked: IDENTITY_EVENT_CONTRACTS.ssoIdentityLinked,
} as const;

export interface AuthenticationSucceededV1Payload {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly providerKey: string;
  readonly assuranceLevel: string | null;
  readonly authenticatedAt: string | null;
}

export interface AuthenticationFailedV1Payload {
  readonly providerKey: string;
  readonly failureCategory:
    | 'identity_ineligible'
    | 'identity_unlinked'
    | 'identity_unverified'
    | 'organization_mismatch'
    | 'protocol_invalid'
    | 'provider_rejected'
    | 'provider_unavailable'
    | 'replay_denied';
}

export type { SSOIdentityLinkedV1Payload };
