import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { AppEnvironment, InvitationConfig } from '@dar-tech/config';
import {
  INVITATION_ACTOR_PORT,
  INVITATION_AUTHORIZATION_PORT,
  INVITATION_CLOCK,
  INVITATION_CONFIG,
  INVITATION_REPOSITORY_PORT,
  INVITATION_SECRET_GENERATOR,
  type InvitationActorPort,
  type InvitationAuthorizationPort,
  type InvitationClock,
  type InvitationRepositoryPort,
  type InvitationSecretGenerator,
} from './invitation.contracts.js';
import { InvitationController, OnboardingController } from './invitation.controller.js';
import { OnboardingRateLimitGuard } from './invitation-rate-limit.guard.js';
import {
  DenyAllInvitationActorAdapter,
  DenyAllInvitationAuthorizationAdapter,
} from './invitation-security.adapters.js';
import { CryptographicInvitationSecretGenerator } from './invitation-secret.js';
import { InvitationService } from './invitation.service.js';
import { PrismaInvitationRepository } from './prisma-invitation.repository.js';

export interface InvitationTestAdapters {
  readonly actors?: InvitationActorPort;
  readonly authorization?: InvitationAuthorizationPort;
  readonly clock?: InvitationClock;
  readonly secrets?: InvitationSecretGenerator;
  readonly repository?: InvitationRepositoryPort;
}

function selectedProvider<T>(
  token: symbol,
  testValue: T | undefined,
  fallback: Provider,
): Provider {
  return testValue ? { provide: token, useValue: testValue } : fallback;
}

@Module({})
export class InvitationModule {
  static register(
    environment: AppEnvironment,
    invitationConfig: InvitationConfig,
    testAdapters?: InvitationTestAdapters,
  ): DynamicModule {
    if (testAdapters && environment !== 'test') {
      throw new Error('Invitation test adapters are available only in the test environment');
    }
    return {
      module: InvitationModule,
      controllers: [InvitationController, OnboardingController],
      providers: [
        { provide: INVITATION_CONFIG, useValue: invitationConfig },
        selectedProvider(
          INVITATION_ACTOR_PORT,
          testAdapters?.actors,
          { provide: INVITATION_ACTOR_PORT, useClass: DenyAllInvitationActorAdapter },
        ),
        selectedProvider(
          INVITATION_AUTHORIZATION_PORT,
          testAdapters?.authorization,
          {
            provide: INVITATION_AUTHORIZATION_PORT,
            useClass: DenyAllInvitationAuthorizationAdapter,
          },
        ),
        selectedProvider(
          INVITATION_CLOCK,
          testAdapters?.clock,
          { provide: INVITATION_CLOCK, useValue: { now: () => new Date() } },
        ),
        selectedProvider(
          INVITATION_SECRET_GENERATOR,
          testAdapters?.secrets,
          {
            provide: INVITATION_SECRET_GENERATOR,
            useClass: CryptographicInvitationSecretGenerator,
          },
        ),
        PrismaInvitationRepository,
        selectedProvider(
          INVITATION_REPOSITORY_PORT,
          testAdapters?.repository,
          { provide: INVITATION_REPOSITORY_PORT, useExisting: PrismaInvitationRepository },
        ),
        OnboardingRateLimitGuard,
        InvitationService,
      ],
      exports: [InvitationService, INVITATION_REPOSITORY_PORT],
    };
  }
}
