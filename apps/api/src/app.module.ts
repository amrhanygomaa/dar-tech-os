import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '@dar-tech/config';
import { DatabaseModule } from '@dar-tech/database';
import { ObservabilityModule, type ObservabilityRegistration } from '@dar-tech/observability';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule, type IdentityTestAdapters } from './identity/identity.module.js';
import { ApiFallbackModule } from './platform/api-fallback.module.js';

export const API_CONFIG = Symbol('API_CONFIG');

export interface AppModuleRegistrationOptions {
  readonly identityTestAdapters?: IdentityTestAdapters;
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
        IdentityModule.register(config.appEnvironment, options.identityTestAdapters),
        ApiFallbackModule,
      ],
      controllers: [AppController],
      providers: [AppService, { provide: API_CONFIG, useValue: config }],
    };
  }
}
