import { type DynamicModule, Module } from '@nestjs/common';
import type { WorkerConfig } from '@dar-tech/config';
import { DATABASE_CLIENT, DatabaseModule, type DatabaseClient } from '@dar-tech/database';
import {
  OutboxConsumerRegistry,
  OutboxDeliveryJobHandler,
  OutboxDispatcher,
  OutboxRouteRegistry,
  PostgresOutboxStore,
  REFERENCE_OUTBOX_ROUTE,
  ReferenceOutboxConsumer,
} from '@dar-tech/outbox';
import {
  ObservabilityModule,
  REQUEST_CONTEXT_STORE,
  STRUCTURED_LOGGER,
  type ObservabilityRegistration,
  type RequestContextStore,
  type StructuredLogger,
} from '@dar-tech/observability';
import {
  CappedExponentialRetryPolicy,
  JobHandlerRegistry,
  JobProcessor,
  PostgresJobQueue,
  RetryProbeJobHandler,
  systemClock,
  type JobQueuePort,
} from '@dar-tech/queue';
import { WorkerRuntimeService } from './worker-runtime.service.js';
import {
  JOB_PROCESSOR,
  JOB_QUEUE,
  OUTBOX_DISPATCHER,
  WORKER_CONFIG,
} from './worker.tokens.js';

@Module({})
export class WorkerModule {
  static register(config: WorkerConfig, observability: ObservabilityRegistration): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ObservabilityModule.register(observability),
        DatabaseModule.register({
          databaseUrl: config.databaseUrl,
          poolMax: config.databasePoolMax,
          connectTimeoutMs: config.databaseConnectTimeoutMs,
          idleTimeoutMs: config.databaseIdleTimeoutMs,
          errorFormat: config.appEnvironment === 'production' ? 'minimal' : 'pretty',
        }),
      ],
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        {
          provide: JOB_QUEUE,
          useFactory: (client: DatabaseClient): JobQueuePort => new PostgresJobQueue(client),
          inject: [DATABASE_CLIENT],
        },
        {
          provide: JOB_PROCESSOR,
          useFactory: (
            client: DatabaseClient,
            queue: JobQueuePort,
            contextStore: RequestContextStore,
            logger: StructuredLogger,
          ): JobProcessor => {
            const deliveryHandler = new OutboxDeliveryJobHandler(
              client,
              new OutboxConsumerRegistry([new ReferenceOutboxConsumer()]),
              logger,
            );
            return new JobProcessor(
              queue,
              new JobHandlerRegistry([new RetryProbeJobHandler(), deliveryHandler]),
              contextStore,
              logger,
              new CappedExponentialRetryPolicy({
                baseDelayMs: config.retryBaseDelayMs,
                maxDelayMs: config.retryMaxDelayMs,
              }),
              systemClock,
            );
          },
          inject: [DATABASE_CLIENT, JOB_QUEUE, REQUEST_CONTEXT_STORE, STRUCTURED_LOGGER],
        },
        {
          provide: OUTBOX_DISPATCHER,
          useFactory: (
            client: DatabaseClient,
            queue: JobQueuePort,
            contextStore: RequestContextStore,
            logger: StructuredLogger,
          ): OutboxDispatcher =>
            new OutboxDispatcher(
              new PostgresOutboxStore(client),
              queue,
              new OutboxRouteRegistry([REFERENCE_OUTBOX_ROUTE]),
              contextStore,
              logger,
              new CappedExponentialRetryPolicy({
                baseDelayMs: config.retryBaseDelayMs,
                maxDelayMs: config.retryMaxDelayMs,
              }),
              systemClock,
            ),
          inject: [DATABASE_CLIENT, JOB_QUEUE, REQUEST_CONTEXT_STORE, STRUCTURED_LOGGER],
        },
        WorkerRuntimeService,
      ],
    };
  }
}
