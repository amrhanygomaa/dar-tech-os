import { writeFile } from 'node:fs/promises';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { WorkerConfig } from '@dar-tech/config';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import { WORKER_CONFIG } from './worker.tokens.js';

@Injectable()
export class WorkerRuntimeService implements OnModuleInit, OnModuleDestroy {
  private keepAliveTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.info('worker.runtime.started');
    await this.writeHeartbeat();
    this.keepAliveTimer = setInterval(() => {
      void this.writeHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }
  }

  private async writeHeartbeat(): Promise<void> {
    if (!this.config.healthFile) {
      return;
    }

    try {
      await writeFile(this.config.healthFile, new Date().toISOString(), { encoding: 'utf8' });
    } catch {
      this.logger.errorEvent('worker.heartbeat.write_failed');
    }
  }
}
