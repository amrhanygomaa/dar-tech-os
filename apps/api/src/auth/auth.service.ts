import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticationConfig } from '@dar-tech/config';
import {
  AUTH_IDENTITY_REPOSITORY_PORT,
  AUTH_INVITATION_ELIGIBILITY_PORT,
  AUTH_PROVIDER_ADAPTERS,
  AUTH_SECURITY_HOOK,
  AUTH_TRANSACTION_PORT,
  type AuthenticationFailureCategory,
  type AuthenticationIdentityRepositoryPort,
  type AuthenticationProviderAdapter,
  type AuthenticationSecurityHook,
  type AuthenticationTransactionPort,
  type InvitationAuthenticationEligibilityPort,
  type LinkedAuthenticationIdentity,
  type NormalizedProviderIdentity,
  type ProtocolValidationRequirement,
  type ProtocolValidationResult,
  type PublicAuthenticationCallback,
  type PublicAuthenticationProvider,
  type PublicAuthenticationStart,
  type PublicProviderLogoutStart,
  type VerifiedAuthenticationOutcome,
  type VerifiedProviderAuthentication,
} from './auth.contracts.js';
import { ProviderAuthenticationError, authenticationFailed } from './auth.errors.js';
import {
  parseAuthenticationCallback,
  parseAuthenticationStart,
  parseProviderKey,
  parseProviderLogout,
} from './auth-input.js';

export const AUTHENTICATION_CONFIG = Symbol('AUTHENTICATION_CONFIG');

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function evidenceSatisfies(
  requirement: ProtocolValidationRequirement,
  evidence: ProtocolValidationResult,
): boolean {
  return requirement === 'required' ? evidence === 'verified' : evidence === 'not_applicable';
}

@Injectable()
export class AuthenticationService {
  private readonly providers: ReadonlyMap<string, AuthenticationProviderAdapter>;
  private readonly redirects: ReadonlySet<string>;

  constructor(
    @Inject(AUTHENTICATION_CONFIG) private readonly config: AuthenticationConfig,
    @Inject(AUTH_PROVIDER_ADAPTERS)
    providerAdapters: readonly AuthenticationProviderAdapter[],
    @Inject(AUTH_TRANSACTION_PORT)
    private readonly transactions: AuthenticationTransactionPort,
    @Inject(AUTH_IDENTITY_REPOSITORY_PORT)
    private readonly identities: AuthenticationIdentityRepositoryPort,
    @Inject(AUTH_INVITATION_ELIGIBILITY_PORT)
    private readonly invitations: InvitationAuthenticationEligibilityPort,
    @Inject(AUTH_SECURITY_HOOK)
    private readonly security: AuthenticationSecurityHook,
  ) {
    const entries = providerAdapters.map((provider) => [provider.metadata.key, provider] as const);
    if (new Set(entries.map(([key]) => key)).size !== entries.length) {
      throw new Error('Authentication provider keys must be unique');
    }
    for (const provider of providerAdapters) this.requireValidProviderContract(provider);
    this.providers = new Map(entries);
    this.redirects = new Set(config.allowedRedirectUris.map((redirect) => new URL(redirect).href));
  }

  listProviders(): readonly PublicAuthenticationProvider[] {
    return [...this.providers.values()].map(({ metadata }) => ({
      key: metadata.key,
      displayName: metadata.displayName,
      iconKey: metadata.iconKey,
      capabilities: {
        authentication: true,
        providerLogout: metadata.capabilities.providerLogout,
      },
    }));
  }

  async start(providerInput: string, input: unknown): Promise<PublicAuthenticationStart> {
    return this.startBound(providerInput, input);
  }

  startForInvitation(
    providerInput: string,
    input: unknown,
    authorizationReference: string,
  ): Promise<PublicAuthenticationStart> {
    return this.startBound(providerInput, input, authorizationReference);
  }

  private async startBound(
    providerInput: string,
    input: unknown,
    authorizationReference?: string,
  ): Promise<PublicAuthenticationStart> {
    const startedAt = performance.now();
    const providerKey = parseProviderKey(providerInput);
    const parsed = parseAuthenticationStart(input);
    try {
      const provider = this.requireProvider(providerKey);
      this.requireAllowedRedirect(parsed.redirectUri);
      const transaction = await this.transactions.create({
        providerKey,
        redirectUri: parsed.redirectUri,
        ttlSeconds: this.config.transactionTtlSeconds,
        ...(authorizationReference ? { authorizationReference } : {}),
      });
      const started = await provider.start({
        transactionId: transaction.id,
        redirectUri: transaction.redirectUri,
        state: transaction.state,
        nonce: transaction.nonce,
        pkceChallenge: transaction.pkceChallenge,
        expiresAt: transaction.expiresAt,
        ...(parsed.loginHint ? { loginHint: parsed.loginHint } : {}),
      });
      return {
        providerKey,
        interaction: started.interaction,
        authorizationUrl: started.authorizationUrl,
        expiresAt: transaction.expiresAt,
        sessionCreated: false,
      };
    } catch (error) {
      await this.recordFailure(this.safeProviderDimension(providerKey), this.failureCategory(error), startedAt);
      throw authenticationFailed();
    }
  }

  async callback(providerInput: string, input: unknown): Promise<PublicAuthenticationCallback> {
    const outcome = await this.verify(providerInput, input);
    return {
      status: outcome.status,
      providerKey: outcome.providerKey,
      sessionCreated: false,
      nextStep: 'SESSION_ISSUANCE_DEFERRED',
    };
  }

  async verify(providerInput: string, input: unknown): Promise<VerifiedAuthenticationOutcome> {
    const startedAt = performance.now();
    const providerKey = parseProviderKey(providerInput);
    const parsed = parseAuthenticationCallback(input);
    try {
      const provider = this.requireProvider(providerKey);
      const consumed = await this.transactions.consume({
        transactionId: parsed.transactionId,
        providerKey,
        receivedState: parsed.state,
      });
      if (consumed.status === 'denied') {
        throw new ProviderAuthenticationError(
          consumed.reason === 'replayed' ? 'replay_denied' : 'protocol_invalid',
        );
      }
      const transaction = consumed.transaction;
      this.requireAllowedRedirect(transaction.redirectUri);
      const verified = await provider.verifyCallback({
        transactionId: transaction.id,
        redirectUri: transaction.redirectUri,
        receivedState: parsed.state,
        expectedState: transaction.state,
        ...(parsed.nonce ? { receivedNonce: parsed.nonce } : {}),
        expectedNonce: transaction.nonce,
        ...(parsed.authorizationCode
          ? { authorizationCode: parsed.authorizationCode }
          : {}),
        ...(parsed.providerError ? { providerError: parsed.providerError } : {}),
        pkceVerifier: transaction.pkceVerifier,
      });
      this.requireValidProviderVerification(provider, verified);
      const principal = await this.resolvePrincipal(
        verified.identity,
        transaction.authorizationReference,
      );
      const outcome: VerifiedAuthenticationOutcome = {
        status: 'VERIFIED',
        providerKey,
        identity: verified.identity,
        principal,
        sessionCreated: false,
      };
      await this.security.record({
        contract: 'AuthenticationSucceeded.v1',
        providerKey,
        outcome: 'succeeded',
        latencyMs: elapsedMilliseconds(startedAt),
        principal:
          principal.kind === 'linked_account'
            ? {
                kind: principal.kind,
                organizationId: principal.organizationId,
                employeeId: principal.employeeId,
                userAccountId: principal.userAccountId,
              }
            : {
                kind: principal.kind,
                organizationId: principal.organizationId,
              },
        assuranceLevel: verified.identity.assurance.level,
        authenticatedAt: verified.identity.authenticatedAt,
      });
      return outcome;
    } catch (error) {
      await this.recordFailure(this.safeProviderDimension(providerKey), this.failureCategory(error), startedAt);
      throw authenticationFailed();
    }
  }

  async startProviderLogout(
    providerInput: string,
    input: unknown,
  ): Promise<PublicProviderLogoutStart> {
    const providerKey = parseProviderKey(providerInput);
    const parsed = parseProviderLogout(input);
    try {
      const provider = this.requireProvider(providerKey);
      if (parsed.postLogoutRedirectUri) this.requireAllowedRedirect(parsed.postLogoutRedirectUri);
      if (!provider.metadata.capabilities.providerLogout || !provider.startLogout) {
        return {
          providerKey,
          providerLogoutSupported: false,
          logoutUrl: null,
          applicationSessionRevoked: false,
        };
      }
      const result = await provider.startLogout(parsed);
      return {
        providerKey,
        providerLogoutSupported: true,
        logoutUrl: result.logoutUrl,
        applicationSessionRevoked: false,
      };
    } catch {
      throw authenticationFailed();
    }
  }

  private requireProvider(providerKey: string): AuthenticationProviderAdapter {
    const provider = this.providers.get(providerKey);
    if (!provider) throw new ProviderAuthenticationError('provider_unavailable');
    return provider;
  }

  private requireValidProviderContract(provider: AuthenticationProviderAdapter): void {
    const { metadata } = provider;
    if (parseProviderKey(metadata.key) !== metadata.key) {
      throw new Error('Authentication provider keys must be normalized');
    }
    if (metadata.capabilities.providerLogout !== Boolean(provider.startLogout)) {
      throw new Error('Provider logout capability must match the adapter implementation');
    }
    if (metadata.adapterKind === 'production') {
      for (const requirement of [
        metadata.protocolRequirements.issuer,
        metadata.protocolRequirements.audience,
        metadata.protocolRequirements.signature,
        metadata.protocolRequirements.timestamps,
      ]) {
        if (requirement !== 'required') {
          throw new Error('Production adapters must require core protocol claim validation');
        }
      }
    }
  }

  private safeProviderDimension(providerKey: string): string {
    return this.providers.has(providerKey) ? providerKey : 'unconfigured';
  }

  private requireAllowedRedirect(redirectUri: string): void {
    if (!this.redirects.has(new URL(redirectUri).href)) {
      throw new ProviderAuthenticationError('protocol_invalid');
    }
  }

  private requireValidProviderVerification(
    provider: AuthenticationProviderAdapter,
    result: VerifiedProviderAuthentication,
  ): void {
    const { identity, verification } = result;
    const requirements = provider.metadata.protocolRequirements;
    const evidencePairs = [
      [requirements.issuer, verification.issuer],
      [requirements.audience, verification.audience],
      [requirements.signature, verification.signature],
      [requirements.timestamps, verification.timestamps],
      [requirements.nonce, verification.nonce],
      [requirements.pkce, verification.pkce],
    ] as const;
    if (
      evidencePairs.some(([requirement, evidence]) => !evidenceSatisfies(requirement, evidence)) ||
      verification.state !== 'verified' ||
      verification.redirectUri !== 'verified' ||
      verification.replay !== 'verified' ||
      verification.identityClaims !== 'verified' ||
      identity.providerKey !== provider.metadata.key ||
      identity.providerSubject.trim().length === 0 ||
      identity.providerSubject.length > 255
    ) {
      throw new ProviderAuthenticationError('protocol_invalid');
    }
    if (identity.emailVerificationStatus === 'unverified') {
      throw new ProviderAuthenticationError('identity_unverified');
    }
    const emailConsistent =
      (identity.emailVerificationStatus === 'verified' && identity.verifiedEmail !== null) ||
      (identity.emailVerificationStatus === 'not_supplied' && identity.verifiedEmail === null);
    if (!emailConsistent) {
      throw new ProviderAuthenticationError('identity_unverified');
    }
  }

  private async resolvePrincipal(
    identity: NormalizedProviderIdentity,
    authorizationReference?: string,
  ) {
    const linked = await this.identities.findLinkedIdentity(
      identity.providerKey,
      identity.providerSubject,
    );
    if (!linked) {
      const invitation = await this.invitations.authorize(identity, authorizationReference);
      if (!invitation) throw new ProviderAuthenticationError('identity_unlinked');
      return {
        kind: 'invitation_authorized' as const,
        organizationId: invitation.organizationId,
        authorizationReference: invitation.authorizationReference,
      };
    }
    this.requireEligibleLinkedIdentity(linked);
    return {
      kind: 'linked_account' as const,
      organizationId: linked.organizationId,
      employeeId: linked.employee.id,
      userAccountId: linked.userAccount.id,
      ssoIdentityId: linked.ssoIdentityId,
    };
  }

  private requireEligibleLinkedIdentity(linked: LinkedAuthenticationIdentity): void {
    const organizationsMatch =
      linked.organizationId === linked.userAccount.organizationId &&
      linked.organizationId === linked.employee.organizationId &&
      linked.userAccount.employeeId === linked.employee.id;
    if (!organizationsMatch) throw new ProviderAuthenticationError('organization_mismatch');
    if (
      linked.employee.lifecycleStatus !== 'ACTIVE' ||
      !linked.userAccount.authenticationEligible ||
      linked.userAccount.disabledAt !== null
    ) {
      throw new ProviderAuthenticationError('identity_ineligible');
    }
  }

  private failureCategory(error: unknown): AuthenticationFailureCategory {
    return error instanceof ProviderAuthenticationError ? error.category : 'provider_unavailable';
  }

  private async recordFailure(
    providerKey: string,
    failureCategory: AuthenticationFailureCategory,
    startedAt: number,
  ): Promise<void> {
    try {
      await this.security.record({
        contract: 'AuthenticationFailed.v1',
        providerKey,
        outcome: 'failed',
        failureCategory,
        latencyMs: elapsedMilliseconds(startedAt),
      });
    } catch {
      // The public failure remains stable even if the future S02-T12 persistence hook is unavailable.
    }
  }
}
