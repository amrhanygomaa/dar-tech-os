import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  SessionCredentialGenerator,
  SessionCredentialMaterial,
} from './session.contracts.js';

const credentialPattern = /^[A-Za-z0-9_-]{43}$/u;

export function isCanonicalSessionCredential(value: string): boolean {
  if (!credentialPattern.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === value;
}

@Injectable()
export class CryptographicSessionCredentialGenerator implements SessionCredentialGenerator {
  generate(): SessionCredentialMaterial {
    const credential = randomBytes(32).toString('base64url');
    return { credential, hash: this.hash(credential) };
  }

  hash(credential: string): string {
    if (!isCanonicalSessionCredential(credential)) {
      throw new TypeError('Session credential is malformed');
    }
    return createHash('sha256').update(credential, 'utf8').digest('hex');
  }
}
