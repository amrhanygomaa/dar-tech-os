import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import type { AppEnvironment, SessionConfig } from '@dar-tech/config';
import {
  SESSION_ADMINISTRATION_AUTHORIZATION_PORT,
  SESSION_CLOCK,
  SESSION_CONFIG,
  SESSION_CREDENTIAL_GENERATOR,
  SESSION_METRICS_PORT,
  SESSION_REPOSITORY_PORT,
  type SessionAdministrationAuthorizationPort,
  type SessionClock,
  type SessionCredentialGenerator,
  type SessionMetricsPort,
  type SessionRepositoryPort,
} from './session.contracts.js';
import { SessionAdministrationController, SessionSelfController } from './session.controller.js';
import { PrismaSessionRepository } from './prisma-session.repository.js';
import {
  StructuredSessionMetricsAdapter,
} from './session-security.adapters.js';
import { CentralSessionAuthorizationAdapter } from '../authorization/authorization.adapters.js';
import { CryptographicSessionCredentialGenerator } from './session-secret.js';
import { SessionService } from './session.service.js';

export interface SessionTestAdapters {
  readonly administrationAuthorization?: SessionAdministrationAuthorizationPort;
  readonly clock?: SessionClock;
  readonly credentials?: SessionCredentialGenerator;
  readonly metrics?: SessionMetricsPort;
  readonly repository?: SessionRepositoryPort;
}

function selectedProvider(token: symbol, value: object | undefined, fallback: Provider): Provider {
  return value ? { provide: token, useValue: value } : fallback;
}

@Global()
@Module({})
export class SessionModule {
  static register(
    environment: AppEnvironment,
    config: SessionConfig,
    testAdapters?: SessionTestAdapters,
  ): DynamicModule {
    if (testAdapters && environment !== 'test') {
      throw new Error('Session test adapters are available only in the test environment');
    }
    return {
      module: SessionModule,
      global: true,
      controllers: [SessionSelfController, SessionAdministrationController],
      providers: [
        { provide: SESSION_CONFIG, useValue: config },
        selectedProvider(SESSION_CLOCK, testAdapters?.clock, {
          provide: SESSION_CLOCK,
          useValue: { now: () => new Date() },
        }),
        selectedProvider(SESSION_CREDENTIAL_GENERATOR, testAdapters?.credentials, {
          provide: SESSION_CREDENTIAL_GENERATOR,
          useClass: CryptographicSessionCredentialGenerator,
        }),
        selectedProvider(
          SESSION_ADMINISTRATION_AUTHORIZATION_PORT,
          testAdapters?.administrationAuthorization,
          {
            provide: SESSION_ADMINISTRATION_AUTHORIZATION_PORT,
            useClass: CentralSessionAuthorizationAdapter,
          },
        ),
        selectedProvider(SESSION_METRICS_PORT, testAdapters?.metrics, {
          provide: SESSION_METRICS_PORT,
          useClass: StructuredSessionMetricsAdapter,
        }),
        PrismaSessionRepository,
        selectedProvider(SESSION_REPOSITORY_PORT, testAdapters?.repository, {
          provide: SESSION_REPOSITORY_PORT,
          useExisting: PrismaSessionRepository,
        }),
        SessionService,
      ],
      exports: [SessionService, SESSION_REPOSITORY_PORT],
    };
  }
}
