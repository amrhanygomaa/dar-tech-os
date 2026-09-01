import type { OutboxConsumer, OutboxRoute } from './contracts.js';

function eventKey(eventType: string, eventVersion: number): string {
  return `${eventType}@v${eventVersion}`;
}

function consumerKey(consumerName: string, eventType: string, eventVersion: number): string {
  return `${consumerName}:${eventKey(eventType, eventVersion)}`;
}

export class OutboxRouteRegistry {
  private readonly routes = new Map<string, OutboxRoute>();

  constructor(routes: readonly OutboxRoute[]) {
    for (const route of routes) {
      const key = eventKey(route.eventType, route.eventVersion);
      if (this.routes.has(key)) {
        throw new Error(`Duplicate outbox route registration: ${key}`);
      }
      this.routes.set(key, route);
    }
  }

  resolve(eventType: string, eventVersion: number): OutboxRoute | undefined {
    return this.routes.get(eventKey(eventType, eventVersion));
  }
}

export class OutboxConsumerRegistry {
  private readonly consumers = new Map<string, OutboxConsumer>();

  constructor(consumers: readonly OutboxConsumer[]) {
    for (const consumer of consumers) {
      const key = consumerKey(consumer.name, consumer.eventType, consumer.eventVersion);
      if (this.consumers.has(key)) {
        throw new Error(`Duplicate outbox consumer registration: ${key}`);
      }
      this.consumers.set(key, consumer);
    }
  }

  resolve(consumerName: string, eventType: string, eventVersion: number): OutboxConsumer | undefined {
    return this.consumers.get(consumerKey(consumerName, eventType, eventVersion));
  }
}
