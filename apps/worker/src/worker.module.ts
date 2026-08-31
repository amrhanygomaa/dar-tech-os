import { Module } from '@nestjs/common';
import { WorkerRuntimeService } from './worker-runtime.service.js';

@Module({
  providers: [WorkerRuntimeService],
})
export class WorkerModule {}
