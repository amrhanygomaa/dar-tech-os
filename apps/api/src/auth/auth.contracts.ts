import type { EmployeeLifecycleStatus } from '../identity/identity.contracts.js';

export const AUTH_PROVIDER_ADAPTERS = Symbol('AUTH_PROVIDER_ADAPTERS');
export const AUTH_TRANSACTION_PORT = Symbol('AUTH_TRANSACTION_PORT');
export const AUTH_IDENTITY_REPOSITORY_PORT = Symbol('AUTH_IDENTITY_REPOSITORY_PORT');
export const AUTH_INVITATION_ELIGIBILITY_PORT = Symbol('AUTH_INVITATION_ELIGIBILITY_PORT');
export const AUTH_SECURITY_HOOK = Symbol('AUTH_SECURITY_HOOK');

export type ProtocolValidationRequirement = 'required' | 'not_applicable';
export type ProtocolValidationResult = 'verified' | 'not_applicable';

export interface AuthenticationProtocolRequirements {
  readonly issuer: ProtocolValidationRequirement;
  readonly audience: ProtocolValidationRequirement;
  readonly signature: ProtocolValidationRequirement;
  readonly timestamps: ProtocolValidationRequirement;
  readonly state: 'required';
  readonly nonce: ProtocolValidationRequirement;
  readonly pkce: ProtocolValidationRequirement;
  readonly redirectUri: 'required';
  readonly replay: 'required';
  readonly identityClaims: 'required';
}

export interface AuthenticationProtocolVerification {
  readonly issuer: ProtocolValidationResult;
  readonly audience: ProtocolValidationResult;
  readonly signature: ProtocolValidationResult;
  readonly timestamps: ProtocolValidationResult;
  readonly state: 'verified';
  readonly nonce: ProtocolValidationResult;
  readonly pkce: ProtocolValidationResult;
  readonly redirectUri: 'verified';
  readonly replay: 'verified';
  readonly identityClaims: 'verified';
}

export interface AuthenticationProviderMetadata {
  readonly key: string;
  readonly displayName: string;
  readonly iconKey: string | null;
  readonly adapterKind: 'local' | 'production';
  readonly capabilities: {
    readonly authentication: true;
    readonly providerLogout: boolean;
    readonly assuranceEvidence: boolean;
    readonly authenticationTimeEvidence: boolean;
  };
  readonly protocolRequirements: AuthenticationProtocolRequirements;
}

export interface ProviderAuthenticationStartRequest {
  readonly transactionId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly pkceChallenge: string;
  readonly expiresAt: Date;
  readonly loginHint?: string;
}

export interface ProviderAuthenticationStartResult {
  readonly interaction: 'redirect';
  readonly authorizationUrl: string;
}

export interface ProviderAuthenticationCallbackRequest {
  readonly transactionId: string;
  readonly redirectUri: string;
  readonly receivedState: string;
  readonly expectedState: string;
  readonly receivedNonce?: string;
  readonly expectedNonce: string;
  readonly authorizationCode?: string;
  readonly providerError?: string;
  readonly pkceVerifier: string;
}

export interface NormalizedProviderIdentity {
  readonly providerKey: string;
  readonly providerSubject: string;
  readonly verifiedEmail: string | null;
  readonly emailVerificationStatus: 'verified' | 'unverified' | 'not_supplied';
  readonly assurance: {
    readonly level: string | null;
    readonly methods: readonly string[];
  };
  readonly authenticatedAt: Date | null;
}

export interface VerifiedProviderAuthentication {
  readonly identity: NormalizedProviderIdentity;
  readonly verification: AuthenticationProtocolVerification;
}

export interface ProviderLogoutStartRequest {
  readonly postLogoutRedirectUri: string | null;
}

export interface ProviderLogoutStartResult {
  readonly logoutUrl: string;
}

export interface AuthenticationProviderAdapter {
  readonly metadata: AuthenticationProviderMetadata;
  start(request: ProviderAuthenticationStartRequest): Promise<ProviderAuthenticationStartResult>;
  verifyCallback(
    request: ProviderAuthenticationCallbackRequest,
  ): Promise<VerifiedProviderAuthentication>;
  startLogout?(request: ProviderLogoutStartRequest): Promise<ProviderLogoutStartResult>;
}

export interface AuthenticationTransactionStart {
  readonly id: string;
  readonly providerKey: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly pkceChallenge: string;
  readonly expiresAt: Date;
  /** Opaque server-created context. Never contains a raw invitation secret. */
  readonly authorizationReference?: string;
}

export interface ConsumedAuthenticationTransaction extends AuthenticationTransactionStart {
  readonly pkceVerifier: string;
}

export type AuthenticationTransactionConsumeResult =
  | {
      readonly status: 'consumed';
      readonly transaction: ConsumedAuthenticationTransaction;
    }
  | {
      readonly status: 'denied';
      readonly reason: 'invalid' | 'replayed';
    };

export interface AuthenticationTransactionPort {
  create(input: {
    readonly providerKey: string;
    readonly redirectUri: string;
    readonly ttlSeconds: number;
    readonly authorizationReference?: string;
  }): Promise<AuthenticationTransactionStart>;
  consume(input: {
    readonly transactionId: string;
    readonly providerKey: string;
    readonly receivedState: string;
  }): Promise<AuthenticationTransactionConsumeResult>;
}

export interface LinkedAuthenticationIdentity {
  readonly ssoIdentityId: string;
  readonly organizationId: string;
  readonly userAccount: {
    readonly id: string;
    readonly organizationId: string;
    readonly employeeId: string;
    readonly authenticationEligible: boolean;
    readonly disabledAt: Date | null;
  };
  readonly employee: {
    readonly id: string;
    readonly organizationId: string;
    readonly lifecycleStatus: EmployeeLifecycleStatus;
  };
}

export interface AuthenticationIdentityRepositoryPort {
  findLinkedIdentity(
    providerKey: string,
    providerSubject: string,
  ): Promise<LinkedAuthenticationIdentity | null>;
}

export interface InvitationAuthenticationAuthorization {
  readonly organizationId: string;
  readonly authorizationReference: string;
}

export interface InvitationAuthenticationEligibilityPort {
  authorize(
    identity: NormalizedProviderIdentity,
    authorizationReference?: string,
  ): Promise<InvitationAuthenticationAuthorization | null>;
}

export const AUTHENTICATION_FAILURE_CATEGORIES = [
  'identity_ineligible',
  'identity_unlinked',
  'identity_unverified',
  'organization_mismatch',
  'protocol_invalid',
  'provider_rejected',
  'provider_unavailable',
  'replay_denied',
] as const;

export type AuthenticationFailureCategory =
  (typeof AUTHENTICATION_FAILURE_CATEGORIES)[number];

export type AuthenticationPrincipal =
  | {
      readonly kind: 'linked_account';
      readonly organizationId: string;
      readonly employeeId: string;
      readonly userAccountId: string;
      readonly ssoIdentityId: string;
    }
  | {
      readonly kind: 'invitation_authorized';
      readonly organizationId: string;
      readonly authorizationReference: string;
    };

export interface VerifiedAuthenticationOutcome {
  readonly status: 'VERIFIED';
  readonly providerKey: string;
  readonly identity: NormalizedProviderIdentity;
  readonly principal: AuthenticationPrincipal;
  readonly sessionCreated: false;
}

export interface AuthenticationSucceededSecurityEvent {
  readonly contract: 'AuthenticationSucceeded.v1';
  readonly providerKey: string;
  readonly outcome: 'succeeded';
  readonly latencyMs: number;
  readonly principal:
    | {
        readonly kind: 'linked_account';
        readonly organizationId: string;
        readonly employeeId: string;
        readonly userAccountId: string;
      }
    | {
        readonly kind: 'invitation_authorized';
        readonly organizationId: string;
      };
  readonly assuranceLevel: string | null;
  readonly authenticatedAt: Date | null;
}

export interface AuthenticationFailedSecurityEvent {
  readonly contract: 'AuthenticationFailed.v1';
  readonly providerKey: string;
  readonly outcome: 'failed';
  readonly failureCategory: AuthenticationFailureCategory;
  readonly latencyMs: number;
}

export type AuthenticationSecurityEvent =
  | AuthenticationSucceededSecurityEvent
  | AuthenticationFailedSecurityEvent;

export interface AuthenticationSecurityHook {
  record(event: AuthenticationSecurityEvent): Promise<void>;
}

export interface PublicAuthenticationProvider {
  readonly key: string;
  readonly displayName: string;
  readonly iconKey: string | null;
  readonly capabilities: {
    readonly authentication: true;
    readonly providerLogout: boolean;
  };
}

export interface PublicAuthenticationStart {
  readonly providerKey: string;
  readonly interaction: 'redirect';
  readonly authorizationUrl: string;
  readonly expiresAt: Date;
  readonly sessionCreated: false;
}

export interface PublicAuthenticationCallback {
  readonly status: 'VERIFIED';
  readonly providerKey: string;
  readonly sessionCreated: false;
  readonly nextStep: 'SESSION_ISSUANCE_DEFERRED';
}

export interface PublicProviderLogoutStart {
  readonly providerKey: string;
  readonly providerLogoutSupported: boolean;
  readonly logoutUrl: string | null;
  readonly applicationSessionRevoked: false;
}
