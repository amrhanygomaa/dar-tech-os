import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '@dar-tech/config';
import { DatabaseModule } from '@dar-tech/database';
import { ObservabilityModule, type ObservabilityRegistration } from '@dar-tech/observability';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule, type IdentityTestAdapters } from './identity/identity.module.js';
import { ApiFallbackModule } from './platform/api-fallback.module.js';
import {
  AuthenticationModule,
  type AuthenticationTestAdapters,
} from './auth/auth.module.js';
import {
  EventHistoryModule,
  type EventHistoryTestAdapters,
} from './event-history/event-history.module.js';
import {
  InvitationModule,
  type InvitationTestAdapters,
} from './invitations/invitation.module.js';
import { RoleModule, type RoleTestAdapters } from './roles/role.module.js';
import {
  PermissionModule,
  type PermissionTestAdapters,
} from './permissions/permission.module.js';
import { SessionModule, type SessionTestAdapters } from './sessions/session.module.js';
import {
  AuthorizationModule,
  type AuthorizationModuleExtensions,
  type AuthorizationTestAdapters,
} from './authorization/authorization.module.js';

export const API_CONFIG = Symbol('API_CONFIG');

export interface AppModuleRegistrationOptions {
  readonly authenticationTestAdapters?: AuthenticationTestAdapters;
  readonly eventHistoryTestAdapters?: EventHistoryTestAdapters;
  readonly identityTestAdapters?: IdentityTestAdapters;
  readonly invitationTestAdapters?: InvitationTestAdapters;
  readonly roleTestAdapters?: RoleTestAdapters;
  readonly permissionTestAdapters?: PermissionTestAdapters;
  readonly sessionTestAdapters?: SessionTestAdapters;
  readonly authorizationTestAdapters?: AuthorizationTestAdapters;
  readonly authorizationExtensions?: AuthorizationModuleExtensions;
}

@Module({})
export class AppModule {
  static register(
    config: ApiConfig,
    observability: ObservabilityRegistration,
    options: AppModuleRegistrationOptions = {},
  ): DynamicModule {
    const databaseOptions = {
      databaseUrl: config.databaseUrl,
      poolMax: config.databasePoolMax,
      connectTimeoutMs: config.databaseConnectTimeoutMs,
      idleTimeoutMs: config.databaseIdleTimeoutMs,
      errorFormat: config.appEnvironment === 'production' ? ('minimal' as const) : ('pretty' as const),
    };
    return {
      module: AppModule,
      imports: [
        ObservabilityModule.register(observability),
        DatabaseModule.register(databaseOptions),
        HealthModule,
        EventHistoryModule.register(config.appEnvironment, options.eventHistoryTestAdapters),
        SessionModule.register(
          config.appEnvironment,
          config.session,
          options.sessionTestAdapters,
        ),
        AuthenticationModule.register(
          config.appEnvironment,
          config.authentication,
          options.authenticationTestAdapters,
          options.invitationTestAdapters?.clock,
        ),
        InvitationModule.register(
          config.appEnvironment,
          config.invitation,
          options.invitationTestAdapters,
        ),
        IdentityModule.register(config.appEnvironment, options.identityTestAdapters),
        RoleModule.register(config.appEnvironment, options.roleTestAdapters),
        PermissionModule.register(config.appEnvironment, options.permissionTestAdapters),
        AuthorizationModule.register(config.appEnvironment, {
          ...(options.authorizationExtensions
            ? { extensions: options.authorizationExtensions }
            : {}),
          ...(options.authorizationTestAdapters
            ? { testAdapters: options.authorizationTestAdapters }
            : {}),
        }),
        ApiFallbackModule,
      ],
      controllers: [AppController],
      providers: [AppService, { provide: API_CONFIG, useValue: config }],
    };
  }
}
