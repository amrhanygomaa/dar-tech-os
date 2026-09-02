import { Inject, Injectable } from '@nestjs/common';
import { STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import type {
  EventHistoryActor,
  EventHistoryActorPort,
  EventHistoryAuthorizationPort,
  EventHistoryMetricsPort,
} from './event-history.contracts.js';

@Injectable()
export class DenyAllEventHistoryActorAdapter implements EventHistoryActorPort {
  currentActor(): Promise<EventHistoryActor | null> {
    return Promise.resolve(null);
  }
}

@Injectable()
export class DenyAllEventHistoryAuthorizationAdapter implements EventHistoryAuthorizationPort {
  authorize(_request: Parameters<EventHistoryAuthorizationPort['authorize']>[0]): Promise<boolean> {
    return Promise.resolve(false);
  }
}

@Injectable()
export class StructuredEventHistoryMetricsAdapter implements EventHistoryMetricsPort {
  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger) {}

  recordWrite(kind: 'audit' | 'security', outcome: 'succeeded' | 'failed'): void {
    const fields = {
      metric: 'event_history_write_total',
      kind,
      outcome,
      increment: 1,
    };
    if (outcome === 'failed') {
      this.logger.errorEvent('eventhistory.metric.write', fields);
    } else {
      this.logger.info('eventhistory.metric.write', fields);
    }
  }

  recordVolume(input: Parameters<EventHistoryMetricsPort['recordVolume']>[0]): void {
    this.logger.info('eventhistory.metric.volume', {
      metric: 'event_history_volume_total',
      kind: input.kind,
      category: input.category,
      outcome: input.outcome,
      ...(input.risk ? { risk: input.risk } : {}),
      increment: 1,
    });
  }
}
