import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { EmergencyAccessConfig } from '@dar-tech/config';
import { AUTHORIZATION_EMERGENCY_GRANT_LOOKUP } from '../authorization/authorization.contracts.js';
import {
  EMERGENCY_ACCESS_ALERT_HOOK,
  EMERGENCY_ACCESS_CONFIG,
  EMERGENCY_ACCESS_REPOSITORY,
} from './emergency-access.contracts.js';
import { EmergencyAccessController } from './emergency-access.controller.js';
import { PrismaAuthorizationEmergencyGrantSource } from './emergency-access-grant-source.js';
import { EmergencyAccessMetrics, StructuredEmergencyAccessAlertHook } from './emergency-access-metrics.js';
import { PrismaEmergencyAccessRepository } from './prisma-emergency-access.repository.js';
import { EmergencyAccessService } from './emergency-access.service.js';

@Global()
@Module({})
export class EmergencyAccessModule {
  static register(config: EmergencyAccessConfig): DynamicModule {
    return {
      module: EmergencyAccessModule,
      controllers: [EmergencyAccessController],
      providers: [
        { provide: EMERGENCY_ACCESS_CONFIG, useValue: config },
        PrismaEmergencyAccessRepository,
        { provide: EMERGENCY_ACCESS_REPOSITORY, useExisting: PrismaEmergencyAccessRepository },
        PrismaAuthorizationEmergencyGrantSource,
        { provide: AUTHORIZATION_EMERGENCY_GRANT_LOOKUP, useExisting: PrismaAuthorizationEmergencyGrantSource },
        EmergencyAccessMetrics,
        StructuredEmergencyAccessAlertHook,
        { provide: EMERGENCY_ACCESS_ALERT_HOOK, useExisting: StructuredEmergencyAccessAlertHook },
        EmergencyAccessService,
      ],
      exports: [EMERGENCY_ACCESS_REPOSITORY, AUTHORIZATION_EMERGENCY_GRANT_LOOKUP, EmergencyAccessService],
    };
  }
}
