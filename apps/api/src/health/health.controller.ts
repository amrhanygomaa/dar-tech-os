import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthService,
  type DependencyHealthStatus,
  type LivenessStatus,
  type ReadinessStatus,
} from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  health(): Promise<DependencyHealthStatus> {
    return this.healthService.health();
  }

  @Get('live')
  liveness(): LivenessStatus {
    return this.healthService.liveness();
  }

  @Get('ready')
  readiness(): Promise<ReadinessStatus> {
    return this.healthService.readiness();
  }
}
