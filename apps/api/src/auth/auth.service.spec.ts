import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticationConfig } from '@dar-tech/config';
import type {
  AuthenticationIdentityRepositoryPort,
  AuthenticationProviderAdapter,
  AuthenticationSecurityEvent,
  AuthenticationSecurityHook,
  InvitationAuthenticationEligibilityPort,
  LinkedAuthenticationIdentity,
} from './auth.contracts.js';
import { AuthenticationModule } from './auth.module.js';
import { AuthenticationService } from './auth.service.js';
import { InMemoryAuthenticationTransactionAdapter } from './in-memory-auth-transaction.adapter.js';
import { LocalAuthenticationProviderAdapter } from './local-auth-provider.adapter.js';

const redirectUri = 'http://localhost:3000/auth/callback';
const now = new Date('2026-09-01T12:00:00.000Z');
const config: AuthenticationConfig = {
  allowedRedirectUris: [redirectUri],
  localProviderEnabled: true,
  localIdentities: [
    {
      loginHint: 'employee',
      providerSubject: 'local-subject',
      verifiedEmail: 'employee@example.com',
    },
  ],
  transactionTtlSeconds: 300,
};

const linkedIdentity: LinkedAuthenticationIdentity = {
  ssoIdentityId: '018f53d4-2f68-7c52-a399-3df2364d8601',
  organizationId: '018f53d4-2f68-7c52-a399-3df2364d8602',
  userAccount: {
    id: '018f53d4-2f68-7c52-a399-3df2364d8603',
    organizationId: '018f53d4-2f68-7c52-a399-3df2364d8602',
    employeeId: '018f53d4-2f68-7c52-a399-3df2364d8604',
    authenticationEligible: true,
    disabledAt: null,
  },
  employee: {
    id: '018f53d4-2f68-7c52-a399-3df2364d8604',
    organizationId: '018f53d4-2f68-7c52-a399-3df2364d8602',
    lifecycleStatus: 'ACTIVE',
  },
};

interface Harness {
  readonly service: AuthenticationService;
  readonly provider: LocalAuthenticationProviderAdapter;
  readonly repository: AuthenticationIdentityRepositoryPort;
  readonly invitations: InvitationAuthenticationEligibilityPort;
  readonly events: AuthenticationSecurityEvent[];
}

function harness(options: {
  linked?: LinkedAuthenticationIdentity | null;
  provider?: AuthenticationProviderAdapter;
  invitationAuthorized?: boolean;
} = {}): Harness {
  const provider = new LocalAuthenticationProviderAdapter(config.localIdentities, () => now);
  const repository: AuthenticationIdentityRepositoryPort = {
    findLinkedIdentity: vi.fn().mockResolvedValue(
      Object.prototype.hasOwnProperty.call(options, 'linked') ? options.linked : linkedIdentity,
    ),
  };
  const invitations: InvitationAuthenticationEligibilityPort = {
    authorize: vi.fn().mockResolvedValue(
      options.invitationAuthorized
        ? {
            organizationId: linkedIdentity.organizationId,
            authorizationReference: 'opaque-invitation-authorization',
          }
        : null,
    ),
  };
  const events: AuthenticationSecurityEvent[] = [];
  const security: AuthenticationSecurityHook = {
    record: vi.fn((event: AuthenticationSecurityEvent) => {
      events.push(event);
      return Promise.resolve();
    }),
  };
  return {
    service: new AuthenticationService(
      config,
      [options.provider ?? provider],
      new InMemoryAuthenticationTransactionAdapter(() => now),
      repository,
      invitations,
      security,
    ),
    provider,
    repository,
    invitations,
    events,
  };
}

async function begin(service: AuthenticationService) {
  const started = await service.start('local', { redirectUri, loginHint: 'employee' });
  const url = new URL(started.authorizationUrl);
  return {
    transactionId: url.searchParams.get('transactionId')!,
    state: url.searchParams.get('state')!,
    nonce: url.searchParams.get('nonce')!,
    code: url.searchParams.get('code')!,
  };
}

function expectSafeAuthenticationFailure(error: unknown): void {
  expect(error).toMatchObject({
    code: 'AUTHENTICATION_FAILED',
    statusCode: 401,
    safeMessage: 'Authentication could not be completed',
  });
  expect(JSON.stringify(error)).not.toMatch(
    /local-subject|employee@example\.com|018f53d4|opaque-invitation/iu,
  );
}

describe('provider-neutral authentication service', () => {
  it('exposes adapter-safe capabilities and a vendor-independent normalized identity', async () => {
    const { service } = harness();
    expect(service.listProviders()).toEqual([
      {
        key: 'local',
        displayName: 'Local development',
        iconKey: 'terminal',
        capabilities: { authentication: true, providerLogout: false },
      },
    ]);

    const callback = await begin(service);
    const outcome = await service.verify('local', callback);

    expect(outcome).toMatchObject({
      status: 'VERIFIED',
      providerKey: 'local',
      identity: {
        providerKey: 'local',
        providerSubject: 'local-subject',
        verifiedEmail: 'employee@example.com',
        emailVerificationStatus: 'verified',
        assurance: { level: 'local-development', methods: ['local-fixture'] },
        authenticatedAt: now,
      },
      principal: {
        kind: 'linked_account',
        organizationId: linkedIdentity.organizationId,
      },
      sessionCreated: false,
    });
    expect(outcome.identity).not.toHaveProperty('vendor');
    expect(outcome.identity).not.toHaveProperty('rawClaims');
    expect(outcome.identity).not.toHaveProperty('token');
  });

  it('denies invalid state and invalid nonce without exposing protocol material', async () => {
    const stateHarness = harness();
    const stateCallback = await begin(stateHarness.service);
    await expect(
      stateHarness.service.callback('local', { ...stateCallback, state: `x${stateCallback.state}` }),
    ).rejects.toSatisfy((error: unknown) => {
      expectSafeAuthenticationFailure(error);
      return true;
    });
    expect(stateHarness.events.at(-1)).toMatchObject({
      contract: 'AuthenticationFailed.v1',
      failureCategory: 'protocol_invalid',
    });

    const nonceHarness = harness();
    const nonceCallback = await begin(nonceHarness.service);
    await expect(
      nonceHarness.service.callback('local', { ...nonceCallback, nonce: `x${nonceCallback.nonce}` }),
    ).rejects.toSatisfy((error: unknown) => {
      expectSafeAuthenticationFailure(error);
      return true;
    });
    expect(JSON.stringify(nonceHarness.events)).not.toContain(nonceCallback.nonce);
  });

  it('denies replay after a successful verification', async () => {
    const { service, events } = harness();
    const callback = await begin(service);
    await expect(service.callback('local', callback)).resolves.toMatchObject({
      status: 'VERIFIED',
      sessionCreated: false,
    });
    await expect(service.callback('local', callback)).rejects.toSatisfy((error: unknown) => {
      expectSafeAuthenticationFailure(error);
      return true;
    });
    expect(events.at(-1)).toMatchObject({ failureCategory: 'replay_denied' });
  });

  it('handles provider rejection and unverified identity through the same public error', async () => {
    const rejectedHarness = harness();
    const rejected = await begin(rejectedHarness.service);
    await expect(
      rejectedHarness.service.callback('local', {
        transactionId: rejected.transactionId,
        state: rejected.state,
        error: 'access_denied',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectSafeAuthenticationFailure(error);
      return true;
    });

    const local = new LocalAuthenticationProviderAdapter(config.localIdentities, () => now);
    const unverifiedProvider: AuthenticationProviderAdapter = {
      metadata: local.metadata,
      start: (request) => local.start(request),
      verifyCallback: async (request) => {
        const verified = await local.verifyCallback(request);
        return {
          ...verified,
          identity: {
            ...verified.identity,
            verifiedEmail: null,
            emailVerificationStatus: 'unverified',
          },
        };
      },
    };
    const unverifiedHarness = harness({ provider: unverifiedProvider });
    const unverified = await begin(unverifiedHarness.service);
    await expect(unverifiedHarness.service.callback('local', unverified)).rejects.toSatisfy(
      (error: unknown) => {
        expectSafeAuthenticationFailure(error);
        return true;
      },
    );
    expect(unverifiedHarness.events.at(-1)).toMatchObject({
      failureCategory: 'identity_unverified',
    });
  });

  it('fails closed for unknown identities unless the future invitation port explicitly authorizes', async () => {
    const deniedHarness = harness({ linked: null });
    const denied = await begin(deniedHarness.service);
    await expect(deniedHarness.service.verify('local', denied)).rejects.toSatisfy(
      (error: unknown) => {
        expectSafeAuthenticationFailure(error);
        return true;
      },
    );
    expect(deniedHarness.invitations.authorize).toHaveBeenCalledOnce();
    expect(deniedHarness.events.at(-1)).toMatchObject({ failureCategory: 'identity_unlinked' });

    const authorizedHarness = harness({ linked: null, invitationAuthorized: true });
    const authorized = await begin(authorizedHarness.service);
    await expect(authorizedHarness.service.verify('local', authorized)).resolves.toMatchObject({
      principal: {
        kind: 'invitation_authorized',
        authorizationReference: 'opaque-invitation-authorization',
      },
      sessionCreated: false,
    });
  });

  it.each(['INVITED', 'SUSPENDED', 'OFFBOARDING', 'ARCHIVED'] as const)(
    'denies a linked employee in the %s lifecycle state',
    async (lifecycleStatus) => {
      const testHarness = harness({
        linked: {
          ...linkedIdentity,
          employee: { ...linkedIdentity.employee, lifecycleStatus },
        },
      });
      const callback = await begin(testHarness.service);
      await expect(testHarness.service.callback('local', callback)).rejects.toSatisfy(
        (error: unknown) => {
          expectSafeAuthenticationFailure(error);
          return true;
        },
      );
      expect(testHarness.events.at(-1)).toMatchObject({
        failureCategory: 'identity_ineligible',
      });
    },
  );

  it.each([
    { authenticationEligible: false, disabledAt: null },
    { authenticationEligible: true, disabledAt: now },
  ])('denies an ineligible or disabled account', async (accountState) => {
    const testHarness = harness({
      linked: {
        ...linkedIdentity,
        userAccount: { ...linkedIdentity.userAccount, ...accountState },
      },
    });
    const callback = await begin(testHarness.service);
    await expect(testHarness.service.callback('local', callback)).rejects.toSatisfy(
      (error: unknown) => {
        expectSafeAuthenticationFailure(error);
        return true;
      },
    );
  });

  it('denies inconsistent organization linkage before returning a principal', async () => {
    const testHarness = harness({
      linked: {
        ...linkedIdentity,
        userAccount: {
          ...linkedIdentity.userAccount,
          organizationId: '018f53d4-2f68-7c52-a399-3df2364d8699',
        },
      },
    });
    const callback = await begin(testHarness.service);
    await expect(testHarness.service.callback('local', callback)).rejects.toSatisfy(
      (error: unknown) => {
        expectSafeAuthenticationFailure(error);
        return true;
      },
    );
    expect(testHarness.events.at(-1)).toMatchObject({
      failureCategory: 'organization_mismatch',
    });
  });

  it('keeps public failures identical across identity/account states', async () => {
    const linkedStates: Array<LinkedAuthenticationIdentity | null> = [
      null,
      { ...linkedIdentity, employee: { ...linkedIdentity.employee, lifecycleStatus: 'SUSPENDED' } },
      {
        ...linkedIdentity,
        userAccount: { ...linkedIdentity.userAccount, disabledAt: now },
      },
    ];
    const failures: Array<{ code: string; statusCode: number; safeMessage: string }> = [];
    for (const linked of linkedStates) {
      const testHarness = harness({ linked });
      const callback = await begin(testHarness.service);
      try {
        await testHarness.service.callback('local', callback);
      } catch (error) {
        const safe = error as { code: string; statusCode: number; safeMessage: string };
        failures.push({ code: safe.code, statusCode: safe.statusCode, safeMessage: safe.safeMessage });
      }
    }
    expect(new Set(failures.map((failure) => JSON.stringify(failure))).size).toBe(1);
  });

  it('does not claim application-session revocation for provider logout', async () => {
    const { service } = harness();
    await expect(service.startProviderLogout('local', {})).resolves.toEqual({
      providerKey: 'local',
      providerLogoutSupported: false,
      logoutUrl: null,
      applicationSessionRevoked: false,
    });
  });

  it('blocks local and test adapters outside development/test composition', () => {
    for (const environment of ['staging', 'production'] as const) {
      expect(() => AuthenticationModule.register(environment, config)).toThrow(
        'Local authentication provider cannot run in staging or production',
      );
      expect(() =>
        AuthenticationModule.register(
          environment,
          { ...config, localProviderEnabled: false },
          { providers: [] },
        ),
      ).toThrow('Authentication test adapters are available only in the test environment');
    }
  });

  it('keeps application code free of production provider SDK imports and raw vendor objects', () => {
    const sources = [
      readFileSync(new URL('./auth.contracts.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('./auth.service.ts', import.meta.url), 'utf8'),
    ].join('\n');
    expect(sources).not.toMatch(/@google|google-auth|microsoft|entra|msal|openid-client/iu);
    expect(sources).not.toMatch(/rawClaims|vendorSdk|idToken|accessToken|refreshToken/iu);
  });

  it('adds no database storage for provider credentials, tokens, sessions, or invitations', () => {
    const schema = readFileSync(
      new URL('../../../../prisma/schema.prisma', import.meta.url),
      'utf8',
    );
    expect(schema).not.toMatch(
      /\b(?:clientSecret|providerSecret|accessToken|refreshToken|authorizationCode)\b/u,
    );
    expect(schema).not.toMatch(/^model\s+(?:Session|Invitation)\b/mu);
  });

  it('requires production adapters to declare core protocol claim validation', () => {
    const local = new LocalAuthenticationProviderAdapter(config.localIdentities, () => now);
    const invalidProductionAdapter: AuthenticationProviderAdapter = {
      metadata: { ...local.metadata, adapterKind: 'production' },
      start: (request) => local.start(request),
      verifyCallback: (request) => local.verifyCallback(request),
    };
    expect(() => harness({ provider: invalidProductionAdapter })).toThrow(
      'Production adapters must require core protocol claim validation',
    );
  });
});
