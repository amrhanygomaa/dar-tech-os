import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AuthenticationTransactionConsumeResult,
  AuthenticationTransactionPort,
  AuthenticationTransactionStart,
  ConsumedAuthenticationTransaction,
} from './auth.contracts.js';

interface StoredAuthenticationTransaction extends ConsumedAuthenticationTransaction {
  readonly stateDigest: Buffer;
}

function randomProtocolValue(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safelyMatches(value: string, expectedDigest: Buffer): boolean {
  const actualDigest = digest(value);
  return actualDigest.length === expectedDigest.length && timingSafeEqual(actualDigest, expectedDigest);
}

export class InMemoryAuthenticationTransactionAdapter implements AuthenticationTransactionPort {
  private readonly active = new Map<string, StoredAuthenticationTransaction>();
  private readonly consumedUntil = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  create(input: {
    readonly providerKey: string;
    readonly redirectUri: string;
    readonly ttlSeconds: number;
  }): Promise<AuthenticationTransactionStart> {
    this.prune();
    const state = randomProtocolValue();
    const nonce = randomProtocolValue();
    const pkceVerifier = randomProtocolValue(48);
    const transaction: StoredAuthenticationTransaction = {
      id: randomUUID(),
      providerKey: input.providerKey,
      redirectUri: input.redirectUri,
      state,
      stateDigest: digest(state),
      nonce,
      pkceVerifier,
      pkceChallenge: createHash('sha256').update(pkceVerifier, 'utf8').digest('base64url'),
      expiresAt: new Date(this.now().getTime() + input.ttlSeconds * 1_000),
    };
    this.active.set(transaction.id, transaction);
    return Promise.resolve(this.publicStart(transaction));
  }

  consume(input: {
    readonly transactionId: string;
    readonly providerKey: string;
    readonly receivedState: string;
  }): Promise<AuthenticationTransactionConsumeResult> {
    this.prune();
    if (this.consumedUntil.has(input.transactionId)) {
      return Promise.resolve({ status: 'denied', reason: 'replayed' });
    }

    const transaction = this.active.get(input.transactionId);
    if (
      !transaction ||
      transaction.providerKey !== input.providerKey ||
      transaction.expiresAt.getTime() <= this.now().getTime() ||
      !safelyMatches(input.receivedState, transaction.stateDigest)
    ) {
      return Promise.resolve({ status: 'denied', reason: 'invalid' });
    }

    this.active.delete(transaction.id);
    this.consumedUntil.set(transaction.id, transaction.expiresAt.getTime());
    return Promise.resolve({ status: 'consumed', transaction: this.consumed(transaction) });
  }

  private publicStart(transaction: StoredAuthenticationTransaction): AuthenticationTransactionStart {
    return {
      id: transaction.id,
      providerKey: transaction.providerKey,
      redirectUri: transaction.redirectUri,
      state: transaction.state,
      nonce: transaction.nonce,
      pkceChallenge: transaction.pkceChallenge,
      expiresAt: transaction.expiresAt,
    };
  }

  private consumed(
    transaction: StoredAuthenticationTransaction,
  ): ConsumedAuthenticationTransaction {
    return {
      ...this.publicStart(transaction),
      pkceVerifier: transaction.pkceVerifier,
    };
  }

  private prune(): void {
    const currentTime = this.now().getTime();
    for (const [id, transaction] of this.active) {
      if (transaction.expiresAt.getTime() <= currentTime) this.active.delete(id);
    }
    for (const [id, expiresAt] of this.consumedUntil) {
      if (expiresAt <= currentTime) this.consumedUntil.delete(id);
    }
  }
}
