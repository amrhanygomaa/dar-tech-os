import { describe, expect, it } from 'vitest';
import { OutboxConsumerRegistry, OutboxRouteRegistry } from '@dar-tech/outbox';
import { IDENTITY_OUTBOX_CONSUMERS, IDENTITY_OUTBOX_ROUTES } from './identity-outbox-events.js';

describe('S02-T02 identity outbox routing', () => {
  it('routes every invitation/onboarding contract to an idempotent local consumer', () => {
    const routes = new OutboxRouteRegistry(IDENTITY_OUTBOX_ROUTES);
    const consumers = new OutboxConsumerRegistry(IDENTITY_OUTBOX_CONSUMERS);
    expect(IDENTITY_OUTBOX_ROUTES.map(({ eventType }) => eventType)).toEqual([
      'identity.employee-invited',
      'identity.invitation-accepted',
      'identity.invitation-revoked',
      'identity.invitation-expired',
      'identity.invitation-superseded',
      'identity.invitation-reissued',
      'identity.onboarding-completed',
      'identity.sso-identity-linked',
    ]);
    for (const route of IDENTITY_OUTBOX_ROUTES) {
      expect(routes.resolve(route.eventType, route.eventVersion)).toEqual(route);
      expect(consumers.resolve(route.consumerName, route.eventType, route.eventVersion)).toBeDefined();
    }
  });
});
