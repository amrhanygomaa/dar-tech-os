import { DynamicModule, Module } from '@nestjs/common';
import type { WorkerConfig } from '@dar-tech/config';
import { DatabaseModule } from '@dar-tech/database';
import { WorkerRuntimeService } from './worker-runtime.service.js';
import { WORKER_CONFIG } from './worker.tokens.js';

@Module({})
export class WorkerModule {
  static register(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        DatabaseModule.register({
          databaseUrl: config.databaseUrl,
          poolMax: config.databasePoolMax,
          connectTimeoutMs: config.databaseConnectTimeoutMs,
          idleTimeoutMs: config.databaseIdleTimeoutMs,
          errorFormat: config.appEnvironment === 'production' ? 'minimal' : 'pretty',
        }),
      ],
      providers: [WorkerRuntimeService, { provide: WORKER_CONFIG, useValue: config }],
    };
  }
}
