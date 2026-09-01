import { DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '@dar-tech/config';
import { DatabaseModule } from '@dar-tech/database';
import { ObservabilityModule, type ObservabilityRegistration } from '@dar-tech/observability';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ApiFallbackController } from './platform/api-fallback.controller.js';

export const API_CONFIG = Symbol('API_CONFIG');

@Module({})
export class AppModule {
  static register(config: ApiConfig, observability: ObservabilityRegistration): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ObservabilityModule.register(observability),
        DatabaseModule.register({
          databaseUrl: config.databaseUrl,
          poolMax: config.databasePoolMax,
          connectTimeoutMs: config.databaseConnectTimeoutMs,
          idleTimeoutMs: config.databaseIdleTimeoutMs,
          errorFormat: config.appEnvironment === 'production' ? 'minimal' : 'pretty',
        }),
      ],
      controllers: [AppController, ApiFallbackController],
      providers: [AppService, { provide: API_CONFIG, useValue: config }],
    };
  }
}
