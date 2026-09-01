import type { RequestContextStore } from '@dar-tech/observability';
import type { Clock, JobQueuePort, RetryPolicy } from '@dar-tech/queue';
import type { OutboxLogger, OutboxStorePort } from './contracts.js';
import type { OutboxRouteRegistry } from './route-registry.js';
import { createOutboxDeliveryJob } from './outbox-delivery.job.js';

export interface OutboxDispatcherOptions {
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly deliveryMaxAttempts: number;
}

export class OutboxDispatcher {
  constructor(
    private readonly store: OutboxStorePort,
    private readonly queue: JobQueuePort,
    private readonly routes: OutboxRouteRegistry,
    private readonly contextStore: RequestContextStore,
    private readonly logger: OutboxLogger,
    private readonly retryPolicy: RetryPolicy,
    private readonly clock: Clock,
  ) {}

  async dispatchNext(options: OutboxDispatcherOptions): Promise<boolean> {
    const event = await this.store.claimNext(options);
    if (!event) {
      return false;
    }

    return this.contextStore.run(
      { runtime: 'worker', jobId: event.id, correlationId: event.correlationId },
      async () => {
        this.logger.info('outbox.event.dispatch_started', {
          eventId: event.id,
          eventType: event.eventType,
          eventVersion: event.eventVersion,
          attemptNumber: event.attemptNumber,
        });

        try {
          const route = this.routes.resolve(event.eventType, event.eventVersion);
          if (!route) {
            await this.store.fail({
              event,
              failure: {
                code: 'outbox.route_not_registered',
                message: 'No route is registered for this outbox event',
              },
              retryAt: null,
            });
            this.logger.errorEvent('outbox.event.dispatch_failed', {
              eventId: event.id,
              failureCode: 'outbox.route_not_registered',
              retryScheduled: false,
            });
            return true;
          }

          await this.queue.enqueue(
            createOutboxDeliveryJob(event, route, options.deliveryMaxAttempts),
          );
          await this.store.complete(event);
          this.logger.info('outbox.event.dispatched', {
            eventId: event.id,
            consumerName: route.consumerName,
          });
        } catch {
          const shouldRetry = event.attemptNumber < event.maxAttempts;
          const retryDelayMs = shouldRetry ? this.retryPolicy.delayMs(event.attemptNumber) : null;
          const retryAt =
            retryDelayMs === null
              ? null
              : new Date(this.clock.now().getTime() + retryDelayMs);
          await this.store.fail({
            event,
            failure: {
              code: 'outbox.provider_unavailable',
              message: 'Outbox delivery provider was unavailable',
            },
            retryAt,
          });

          const fields = {
            eventId: event.id,
            failureCode: 'outbox.provider_unavailable',
            retryScheduled: retryAt !== null,
            ...(retryDelayMs === null ? {} : { retryDelayMs }),
          };
          if (retryAt) {
            this.logger.warnEvent('outbox.event.retry_scheduled', fields);
          } else {
            this.logger.errorEvent('outbox.event.dispatch_failed', fields);
          }
        }

        return true;
      },
    );
  }
}
