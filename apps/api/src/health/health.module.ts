import { type DynamicModule, Module } from '@nestjs/common';
import { DatabaseModule, type DatabaseClientOptions } from '@dar-tech/database';
import { DATABASE_READINESS_PORT } from './database-readiness.port.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { PrismaDatabaseReadinessAdapter } from './prisma-database-readiness.adapter.js';

@Module({})
export class HealthModule {
  static register(databaseOptions: DatabaseClientOptions): DynamicModule {
    return {
      module: HealthModule,
      imports: [DatabaseModule.register(databaseOptions)],
      controllers: [HealthController],
      providers: [
        HealthService,
        PrismaDatabaseReadinessAdapter,
        {
          provide: DATABASE_READINESS_PORT,
          useExisting: PrismaDatabaseReadinessAdapter,
        },
      ],
    };
  }
}
