import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { AppEnvironment } from '@dar-tech/config';
import {
  OFFBOARDING_CLEANUP_FAILURE_HOOK,
  OFFBOARDING_REPOSITORY,
  type OffboardingCleanupFailureHook,
} from './offboarding.contracts.js';
import { OffboardingController } from './offboarding.controller.js';
import { OffboardingMetrics } from './offboarding-metrics.js';
import { OffboardingService } from './offboarding.service.js';
import { PrismaOffboardingRepository } from './prisma-offboarding.repository.js';

export interface OffboardingTestAdapters {
  readonly cleanupFailureHook?: OffboardingCleanupFailureHook;
}

@Module({})
export class OffboardingModule {
  static register(environment: AppEnvironment, testAdapters?: OffboardingTestAdapters): DynamicModule {
    if (testAdapters && environment !== 'test') {
      throw new Error('Offboarding test adapters are available only in the test environment');
    }
    const failureProvider: Provider = {
      provide: OFFBOARDING_CLEANUP_FAILURE_HOOK,
      useValue: testAdapters?.cleanupFailureHook ?? {},
    };
    return {
      module: OffboardingModule,
      controllers: [OffboardingController],
      providers: [
        failureProvider,
        PrismaOffboardingRepository,
        { provide: OFFBOARDING_REPOSITORY, useExisting: PrismaOffboardingRepository },
        OffboardingMetrics,
        OffboardingService,
      ],
      exports: [OffboardingService],
    };
  }
}
