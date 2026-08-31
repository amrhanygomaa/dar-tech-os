import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

@Injectable()
export class WorkerRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerRuntimeService.name);
  private keepAliveTimer: NodeJS.Timeout | undefined;

  onModuleInit(): void {
    this.logger.log('Worker foundation runtime started');
    this.keepAliveTimer = setInterval(() => undefined, 60_000);
  }

  onModuleDestroy(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }
  }
}
