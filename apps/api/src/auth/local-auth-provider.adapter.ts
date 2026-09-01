import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { LocalAuthenticationIdentityConfig } from '@dar-tech/config';
import type {
  AuthenticationProviderAdapter,
  AuthenticationProviderMetadata,
  ProviderAuthenticationCallbackRequest,
  ProviderAuthenticationStartRequest,
  ProviderAuthenticationStartResult,
  VerifiedProviderAuthentication,
} from './auth.contracts.js';
import { ProviderAuthenticationError } from './auth.errors.js';

interface LocalAuthorizationCode {
  readonly transactionId: string;
  readonly identity: LocalAuthenticationIdentityConfig;
  readonly expiresAt: Date;
}

function safeEqual(left: string, right: string): boolean {
  const leftValue = Buffer.from(left, 'utf8');
  const rightValue = Buffer.from(right, 'utf8');
  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue);
}

export class LocalAuthenticationProviderAdapter implements AuthenticationProviderAdapter {
  readonly metadata: AuthenticationProviderMetadata = {
    key: 'local',
    displayName: 'Local development',
    iconKey: 'terminal',
    adapterKind: 'local',
    capabilities: {
      authentication: true,
      providerLogout: false,
      assuranceEvidence: true,
      authenticationTimeEvidence: true,
    },
    protocolRequirements: {
      issuer: 'not_applicable',
      audience: 'not_applicable',
      signature: 'not_applicable',
      timestamps: 'required',
      state: 'required',
      nonce: 'required',
      pkce: 'not_applicable',
      redirectUri: 'required',
      replay: 'required',
      identityClaims: 'required',
    },
  };

  private readonly identities: ReadonlyMap<string, LocalAuthenticationIdentityConfig>;
  private readonly codes = new Map<string, LocalAuthorizationCode>();

  constructor(
    identities: readonly LocalAuthenticationIdentityConfig[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.identities = new Map(identities.map((identity) => [identity.loginHint, identity]));
  }

  start(
    request: ProviderAuthenticationStartRequest,
  ): Promise<ProviderAuthenticationStartResult> {
    this.prune();
    const identity = request.loginHint ? this.identities.get(request.loginHint) : undefined;
    if (!identity) throw new ProviderAuthenticationError('provider_rejected');

    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, {
      transactionId: request.transactionId,
      identity,
      expiresAt: request.expiresAt,
    });
    const authorizationUrl = new URL(request.redirectUri);
    authorizationUrl.searchParams.set('transactionId', request.transactionId);
    authorizationUrl.searchParams.set('state', request.state);
    authorizationUrl.searchParams.set('nonce', request.nonce);
    authorizationUrl.searchParams.set('code', code);
    return Promise.resolve({ interaction: 'redirect', authorizationUrl: authorizationUrl.href });
  }

  verifyCallback(
    request: ProviderAuthenticationCallbackRequest,
  ): Promise<VerifiedProviderAuthentication> {
    this.prune();
    if (request.providerError || !request.authorizationCode || !request.receivedNonce) {
      throw new ProviderAuthenticationError('provider_rejected');
    }

    const authorization = this.codes.get(request.authorizationCode);
    this.codes.delete(request.authorizationCode);
    if (
      !authorization ||
      authorization.expiresAt.getTime() <= this.now().getTime() ||
      authorization.transactionId !== request.transactionId
    ) {
      throw new ProviderAuthenticationError('replay_denied');
    }
    if (
      !safeEqual(request.receivedState, request.expectedState) ||
      !safeEqual(request.receivedNonce, request.expectedNonce)
    ) {
      throw new ProviderAuthenticationError('protocol_invalid');
    }

    const verifiedEmail = authorization.identity.verifiedEmail?.trim().toLowerCase() ?? null;
    return Promise.resolve({
      identity: {
        providerKey: this.metadata.key,
        providerSubject: authorization.identity.providerSubject.trim(),
        verifiedEmail,
        emailVerificationStatus: verifiedEmail ? 'verified' : 'not_supplied',
        assurance: { level: 'local-development', methods: ['local-fixture'] },
        authenticatedAt: this.now(),
      },
      verification: {
        issuer: 'not_applicable',
        audience: 'not_applicable',
        signature: 'not_applicable',
        timestamps: 'verified',
        state: 'verified',
        nonce: 'verified',
        pkce: 'not_applicable',
        redirectUri: 'verified',
        replay: 'verified',
        identityClaims: 'verified',
      },
    });
  }

  private prune(): void {
    const currentTime = this.now().getTime();
    for (const [code, authorization] of this.codes) {
      if (authorization.expiresAt.getTime() <= currentTime) this.codes.delete(code);
    }
  }
}
