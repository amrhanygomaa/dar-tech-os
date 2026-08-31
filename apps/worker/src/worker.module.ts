import { DynamicModule, Module } from '@nestjs/common';
import type { WorkerConfig } from '@dar-tech/config';
import { WorkerRuntimeService } from './worker-runtime.service.js';

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');

@Module({})
export class WorkerModule {
  static register(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      providers: [WorkerRuntimeService, { provide: WORKER_CONFIG, useValue: config }],
    };
  }
}
