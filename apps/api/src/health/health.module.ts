import { Module } from '@nestjs/common';
import { DATABASE_READINESS_PORT } from './database-readiness.port.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { PrismaDatabaseReadinessAdapter } from './prisma-database-readiness.adapter.js';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    PrismaDatabaseReadinessAdapter,
    {
      provide: DATABASE_READINESS_PORT,
      useExisting: PrismaDatabaseReadinessAdapter,
    },
  ],
})
export class HealthModule {}
