import { describe, expect, it } from 'vitest';
import { InMemoryAuthenticationTransactionAdapter } from './in-memory-auth-transaction.adapter.js';

describe('in-memory authentication transaction adapter', () => {
  it('correlates state and retains nonce/PKCE material only behind the transient port', async () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    const adapter = new InMemoryAuthenticationTransactionAdapter(() => now);
    const transaction = await adapter.create({
      providerKey: 'test-provider',
      redirectUri: 'http://localhost/callback',
      ttlSeconds: 300,
    });

    expect(transaction.state).toHaveLength(43);
    expect(transaction.nonce).toHaveLength(43);
    expect(transaction.pkceChallenge).toHaveLength(43);
    const consumed = await adapter.consume({
      transactionId: transaction.id,
      providerKey: transaction.providerKey,
      receivedState: transaction.state,
    });
    expect(consumed).toMatchObject({
      status: 'consumed',
      transaction: {
        id: transaction.id,
        nonce: transaction.nonce,
        pkceVerifier: expect.any(String),
      },
    });
  });

  it('denies invalid state, expiry, and replay without timing assumptions', async () => {
    let now = new Date('2026-09-01T12:00:00.000Z');
    const adapter = new InMemoryAuthenticationTransactionAdapter(() => now);
    const transaction = await adapter.create({
      providerKey: 'test-provider',
      redirectUri: 'http://localhost/callback',
      ttlSeconds: 60,
    });
    await expect(
      adapter.consume({
        transactionId: transaction.id,
        providerKey: transaction.providerKey,
        receivedState: `x${transaction.state}`,
      }),
    ).resolves.toEqual({ status: 'denied', reason: 'invalid' });
    await expect(
      adapter.consume({
        transactionId: transaction.id,
        providerKey: transaction.providerKey,
        receivedState: transaction.state,
      }),
    ).resolves.toMatchObject({ status: 'consumed' });
    await expect(
      adapter.consume({
        transactionId: transaction.id,
        providerKey: transaction.providerKey,
        receivedState: transaction.state,
      }),
    ).resolves.toEqual({ status: 'denied', reason: 'replayed' });

    const expired = await adapter.create({
      providerKey: 'test-provider',
      redirectUri: 'http://localhost/callback',
      ttlSeconds: 60,
    });
    now = new Date('2026-09-01T12:01:00.000Z');
    await expect(
      adapter.consume({
        transactionId: expired.id,
        providerKey: expired.providerKey,
        receivedState: expired.state,
      }),
    ).resolves.toEqual({ status: 'denied', reason: 'invalid' });
  });
});
