import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import type { AppEnvironment, AuthenticationConfig } from '@dar-tech/config';
import { DATABASE_CLIENT, type DatabaseClient } from '@dar-tech/database';
import {
  AUTH_IDENTITY_REPOSITORY_PORT,
  AUTH_INVITATION_ELIGIBILITY_PORT,
  AUTH_PROVIDER_ADAPTERS,
  AUTH_SECURITY_HOOK,
  AUTH_TRANSACTION_PORT,
  type AuthenticationIdentityRepositoryPort,
  type AuthenticationProviderAdapter,
  type AuthenticationSecurityHook,
  type AuthenticationTransactionPort,
  type InvitationAuthenticationEligibilityPort,
} from './auth.contracts.js';
import { AuthenticationController } from './auth.controller.js';
import {
  DurableAuthenticationSecurityHook,
  PrismaInvitationAuthenticationEligibilityAdapter,
} from './auth-security.adapters.js';
import { AuthenticationService, AUTHENTICATION_CONFIG } from './auth.service.js';
import { InMemoryAuthenticationTransactionAdapter } from './in-memory-auth-transaction.adapter.js';
import { LocalAuthenticationProviderAdapter } from './local-auth-provider.adapter.js';
import { PrismaAuthenticationIdentityRepository } from './prisma-auth-identity.repository.js';

export interface AuthenticationTestAdapters {
  readonly providers?: readonly AuthenticationProviderAdapter[];
  readonly transactions?: AuthenticationTransactionPort;
  readonly identities?: AuthenticationIdentityRepositoryPort;
  readonly invitations?: InvitationAuthenticationEligibilityPort;
  readonly security?: AuthenticationSecurityHook;
}

function selectedProviders(
  environment: AppEnvironment,
  config: AuthenticationConfig,
  testAdapters?: AuthenticationTestAdapters,
): readonly AuthenticationProviderAdapter[] {
  if (testAdapters?.providers) return testAdapters.providers;
  if (!config.localProviderEnabled) return [];
  if (environment === 'staging' || environment === 'production') {
    throw new Error('Local authentication provider cannot run in staging or production');
  }
  return [new LocalAuthenticationProviderAdapter(config.localIdentities)];
}

@Global()
@Module({})
export class AuthenticationModule {
  static register(
    environment: AppEnvironment,
    config: AuthenticationConfig,
    testAdapters?: AuthenticationTestAdapters,
    invitationClock: { now(): Date } = { now: () => new Date() },
  ): DynamicModule {
    if (testAdapters && environment !== 'test') {
      throw new Error('Authentication test adapters are available only in the test environment');
    }
    if (config.localProviderEnabled && (environment === 'staging' || environment === 'production')) {
      throw new Error('Local authentication provider cannot run in staging or production');
    }

    const transactionProvider: Provider = testAdapters?.transactions
      ? { provide: AUTH_TRANSACTION_PORT, useValue: testAdapters.transactions }
      : { provide: AUTH_TRANSACTION_PORT, useValue: new InMemoryAuthenticationTransactionAdapter() };
    const identityProvider: Provider = testAdapters?.identities
      ? { provide: AUTH_IDENTITY_REPOSITORY_PORT, useValue: testAdapters.identities }
      : {
          provide: AUTH_IDENTITY_REPOSITORY_PORT,
          useClass: PrismaAuthenticationIdentityRepository,
        };
    const invitationProvider: Provider = testAdapters?.invitations
      ? { provide: AUTH_INVITATION_ELIGIBILITY_PORT, useValue: testAdapters.invitations }
      : {
          provide: AUTH_INVITATION_ELIGIBILITY_PORT,
          useFactory: (client: DatabaseClient) =>
            new PrismaInvitationAuthenticationEligibilityAdapter(
              client,
              () => invitationClock.now(),
            ),
          inject: [DATABASE_CLIENT],
        };
    const securityProvider: Provider = testAdapters?.security
      ? { provide: AUTH_SECURITY_HOOK, useValue: testAdapters.security }
      : { provide: AUTH_SECURITY_HOOK, useClass: DurableAuthenticationSecurityHook };

    return {
      module: AuthenticationModule,
      controllers: [AuthenticationController],
      providers: [
        { provide: AUTHENTICATION_CONFIG, useValue: config },
        { provide: AUTH_PROVIDER_ADAPTERS, useValue: selectedProviders(environment, config, testAdapters) },
        transactionProvider,
        identityProvider,
        invitationProvider,
        securityProvider,
        AuthenticationService,
      ],
      exports: [AuthenticationService, AUTH_PROVIDER_ADAPTERS],
    };
  }
}
