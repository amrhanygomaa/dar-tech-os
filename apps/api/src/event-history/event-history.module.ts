import {
  type DynamicModule,
  Global,
  type InjectionToken,
  Module,
  type Provider,
} from '@nestjs/common';
import type { AppEnvironment } from '@dar-tech/config';
import {
  AUDIT_EVENT_APPEND_PORT,
  AUDIT_EVENT_READ_REPOSITORY_PORT,
  EVENT_HISTORY_ACTOR_PORT,
  EVENT_HISTORY_AUTHORIZATION_PORT,
  EVENT_HISTORY_METRICS_PORT,
  SECURITY_EVENT_APPEND_PORT,
  SECURITY_EVENT_READ_REPOSITORY_PORT,
  type AuditEventAppendPort,
  type AuditEventReadRepositoryPort,
  type EventHistoryActorPort,
  type EventHistoryAuthorizationPort,
  type EventHistoryMetricsPort,
  type SecurityEventAppendPort,
  type SecurityEventReadRepositoryPort,
} from './event-history.contracts.js';
import { AuditEventsController, SecurityEventsController } from './event-history.controller.js';
import {
  StructuredEventHistoryMetricsAdapter,
} from './event-history-security.adapters.js';
import {
  CentralAuthenticatedActorAdapter,
  CentralEventHistoryAuthorizationAdapter,
} from '../authorization/authorization.adapters.js';
import { EventHistoryService } from './event-history.service.js';
import {
  PrismaAuditEventRepository,
  PrismaEventHistoryRepository,
  PrismaSecurityEventRepository,
} from './prisma-event-history.repository.js';

export interface EventHistoryTestAdapters {
  readonly actors?: EventHistoryActorPort;
  readonly authorization?: EventHistoryAuthorizationPort;
  readonly metrics?: EventHistoryMetricsPort;
  readonly auditAppender?: AuditEventAppendPort;
  readonly auditReader?: AuditEventReadRepositoryPort;
  readonly securityAppender?: SecurityEventAppendPort;
  readonly securityReader?: SecurityEventReadRepositoryPort;
}

function provider(
  token: symbol,
  testValue: object | undefined,
  existing: InjectionToken,
): Provider {
  return testValue
    ? { provide: token, useValue: testValue }
    : { provide: token, useExisting: existing };
}

@Global()
@Module({})
export class EventHistoryModule {
  static register(
    environment: AppEnvironment,
    testAdapters?: EventHistoryTestAdapters,
  ): DynamicModule {
    if (testAdapters && environment !== 'test') {
      throw new Error('Event history test adapters are available only in the test environment');
    }

    const actorProvider: Provider = testAdapters?.actors
      ? { provide: EVENT_HISTORY_ACTOR_PORT, useValue: testAdapters.actors }
      : {
          provide: EVENT_HISTORY_ACTOR_PORT,
          useClass: CentralAuthenticatedActorAdapter,
        };
    const authorizationProvider: Provider = testAdapters?.authorization
      ? {
          provide: EVENT_HISTORY_AUTHORIZATION_PORT,
          useValue: testAdapters.authorization,
        }
      : {
          provide: EVENT_HISTORY_AUTHORIZATION_PORT,
          useClass: CentralEventHistoryAuthorizationAdapter,
        };
    const metricsProvider: Provider = testAdapters?.metrics
      ? { provide: EVENT_HISTORY_METRICS_PORT, useValue: testAdapters.metrics }
      : {
          provide: EVENT_HISTORY_METRICS_PORT,
          useClass: StructuredEventHistoryMetricsAdapter,
        };

    return {
      module: EventHistoryModule,
      global: true,
      controllers: [AuditEventsController, SecurityEventsController],
      providers: [
        actorProvider,
        authorizationProvider,
        metricsProvider,
        PrismaEventHistoryRepository,
        PrismaAuditEventRepository,
        PrismaSecurityEventRepository,
        provider(AUDIT_EVENT_APPEND_PORT, testAdapters?.auditAppender, PrismaAuditEventRepository),
        provider(
          AUDIT_EVENT_READ_REPOSITORY_PORT,
          testAdapters?.auditReader,
          PrismaAuditEventRepository,
        ),
        provider(
          SECURITY_EVENT_APPEND_PORT,
          testAdapters?.securityAppender,
          PrismaSecurityEventRepository,
        ),
        provider(
          SECURITY_EVENT_READ_REPOSITORY_PORT,
          testAdapters?.securityReader,
          PrismaSecurityEventRepository,
        ),
        EventHistoryService,
      ],
      exports: [
        AUDIT_EVENT_APPEND_PORT,
        AUDIT_EVENT_READ_REPOSITORY_PORT,
        SECURITY_EVENT_APPEND_PORT,
        SECURITY_EVENT_READ_REPOSITORY_PORT,
        EVENT_HISTORY_METRICS_PORT,
        EventHistoryService,
        PrismaAuditEventRepository,
        PrismaSecurityEventRepository,
      ],
    };
  }
}
