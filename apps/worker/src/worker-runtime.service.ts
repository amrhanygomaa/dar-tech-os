import { writeFile } from 'node:fs/promises';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { WorkerConfig } from '@dar-tech/config';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import type { OutboxDispatcher } from '@dar-tech/outbox';
import type { JobProcessor } from '@dar-tech/queue';
import {
  JOB_PROCESSOR,
  OUTBOX_DISPATCHER,
  WORKER_CONFIG,
} from './worker.tokens.js';

@Injectable()
export class WorkerRuntimeService implements OnModuleInit, OnModuleDestroy {
  private keepAliveTimer: NodeJS.Timeout | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private activePoll: Promise<void> | undefined;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
    @Inject(JOB_PROCESSOR) private readonly jobProcessor: JobProcessor,
    @Inject(OUTBOX_DISPATCHER) private readonly outboxDispatcher: OutboxDispatcher,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.info('worker.runtime.started');
    await this.writeHeartbeat();
    this.keepAliveTimer = setInterval(() => {
      void this.writeHeartbeat();
    }, this.config.heartbeatIntervalMs);
    void this.pollOnce();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.config.pollIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    await this.activePoll;
  }

  private async pollOnce(): Promise<void> {
    if (this.activePoll) {
      return;
    }

    const operation = this.processFoundationWorkSafely();
    this.activePoll = operation;
    try {
      await operation;
    } finally {
      if (this.activePoll === operation) {
        this.activePoll = undefined;
      }
    }
  }

  private async processFoundationWorkSafely(): Promise<void> {
    try {
      await this.outboxDispatcher.dispatchNext({
        workerId: this.config.workerId,
        leaseDurationMs: this.config.leaseDurationMs,
        deliveryMaxAttempts: this.config.jobMaxAttempts,
      });
      await this.jobProcessor.processNext({
        queue: this.config.queueName,
        workerId: this.config.workerId,
        leaseDurationMs: this.config.leaseDurationMs,
      });
    } catch {
      this.logger.errorEvent('worker.poll.failed');
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
