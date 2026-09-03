import type { OutboxConsumer, OutboxEventEnvelope, OutboxRoute } from '@dar-tech/outbox';
import type { DatabaseTransaction } from '@dar-tech/database';

const eventTypes = [
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
  'identity.session-created',
  'identity.session-revoked',
  'identity.all-sessions-revoked',
] as const;

const consumerName = 'identity.lifecycle-history';

export const IDENTITY_OUTBOX_ROUTES: readonly OutboxRoute[] = eventTypes.map((eventType) => ({
  eventType,
  eventVersion: 1,
  consumerName,
  queue: 'foundation',
}));

class IdentityLifecycleHistoryConsumer implements OutboxConsumer {
  readonly name = consumerName;
  readonly eventVersion = 1;

  constructor(readonly eventType: (typeof eventTypes)[number]) {}

  handle(_event: OutboxEventEnvelope, _transaction: DatabaseTransaction): Promise<void> {
    // The idempotency receipt is the current durable local side effect. Future
    // notification/integration owners can add subscribers without changing the
    // identity command contracts.
    return Promise.resolve();
  }
}

export const IDENTITY_OUTBOX_CONSUMERS: readonly OutboxConsumer[] = eventTypes.map(
  (eventType) => new IdentityLifecycleHistoryConsumer(eventType),
);
