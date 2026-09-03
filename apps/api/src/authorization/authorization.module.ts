import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import type { AppEnvironment } from '@dar-tech/config';
import { PERMISSION_REPOSITORY_PORT } from '../permissions/permission.contracts.js';
import {
  CentralAuthenticatedActorAdapter,
  CentralEventHistoryAuthorizationAdapter,
  CentralIdentityAuthorizationAdapter,
  CentralInvitationAuthorizationAdapter,
  CentralPermissionAuthorizationAdapter,
  CentralRoleAuthorizationAdapter,
  CentralSessionAuthorizationAdapter,
} from './authorization.adapters.js';
import { AuthorizationActorContext } from './authorization-context.js';
import {
  AUTHORIZATION_CLOCK,
  AUTHORIZATION_GRANT_REPOSITORY,
  AUTHORIZATION_METRICS_PORT,
  AUTHORIZATION_SCOPE_RESOLVERS,
  type AuthorizationClock,
  type AuthorizationGrantRepository,
  type AuthorizationMetricsPort,
  type AuthorizationScopeResolver,
} from './authorization.contracts.js';
import { StructuredAuthorizationMetricsAdapter } from './authorization-metrics.js';
import { AuthorizationRequestMiddleware } from './authorization-request.middleware.js';
import { AuthorizationService } from './authorization.service.js';

export interface AuthorizationTestAdapters {
  readonly clock?: AuthorizationClock;
  readonly grants?: AuthorizationGrantRepository;
  readonly metrics?: AuthorizationMetricsPort;
  readonly scopeResolvers?: readonly AuthorizationScopeResolver[];
}

function selectedProvider(token: symbol, value: object | undefined, fallback: Provider): Provider {
  return value ? { provide: token, useValue: value } : fallback;
}

@Global()
@Module({})
export class AuthorizationModule {
  static register(environment: AppEnvironment, testAdapters?: AuthorizationTestAdapters): DynamicModule {
    if (testAdapters && environment !== 'test') {
      throw new Error('Authorization test adapters are available only in the test environment');
    }
    return {
      module: AuthorizationModule,
      global: true,
      providers: [
        AuthorizationActorContext,
        selectedProvider(AUTHORIZATION_CLOCK, testAdapters?.clock, {
          provide: AUTHORIZATION_CLOCK,
          useValue: { now: () => new Date() },
        }),
        selectedProvider(AUTHORIZATION_GRANT_REPOSITORY, testAdapters?.grants, {
          provide: AUTHORIZATION_GRANT_REPOSITORY,
          useExisting: PERMISSION_REPOSITORY_PORT,
        }),
        selectedProvider(AUTHORIZATION_METRICS_PORT, testAdapters?.metrics, {
          provide: AUTHORIZATION_METRICS_PORT,
          useClass: StructuredAuthorizationMetricsAdapter,
        }),
        {
          provide: AUTHORIZATION_SCOPE_RESOLVERS,
          useValue: testAdapters?.scopeResolvers ?? [],
        },
        AuthorizationService,
        AuthorizationRequestMiddleware,
        CentralAuthenticatedActorAdapter,
        CentralIdentityAuthorizationAdapter,
        CentralInvitationAuthorizationAdapter,
        CentralRoleAuthorizationAdapter,
        CentralPermissionAuthorizationAdapter,
        CentralEventHistoryAuthorizationAdapter,
        CentralSessionAuthorizationAdapter,
      ],
      exports: [
        AUTHORIZATION_CLOCK,
        AuthorizationActorContext,
        AuthorizationService,
        AuthorizationRequestMiddleware,
        CentralAuthenticatedActorAdapter,
        CentralIdentityAuthorizationAdapter,
        CentralInvitationAuthorizationAdapter,
        CentralRoleAuthorizationAdapter,
        CentralPermissionAuthorizationAdapter,
        CentralEventHistoryAuthorizationAdapter,
        CentralSessionAuthorizationAdapter,
      ],
    };
  }
}
