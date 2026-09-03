import { describe, expect, it } from 'vitest';
import { OutboxConsumerRegistry, OutboxRouteRegistry } from '@dar-tech/outbox';
import { IDENTITY_OUTBOX_CONSUMERS, IDENTITY_OUTBOX_ROUTES } from './identity-outbox-events.js';

describe('Sprint 02 identity outbox routing', () => {
  it('routes every implemented identity contract to an idempotent local consumer', () => {
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
      'identity.role-created',
      'identity.role-updated',
      'identity.role-archived',
      'identity.employee-role-assigned',
      'identity.employee-role-removed',
      'identity.permission-registered',
      'identity.role-permission-granted',
      'identity.role-permission-removed',
    ]);
    for (const route of IDENTITY_OUTBOX_ROUTES) {
      expect(routes.resolve(route.eventType, route.eventVersion)).toEqual(route);
      expect(consumers.resolve(route.consumerName, route.eventType, route.eventVersion)).toBeDefined();
    }
  });
});
