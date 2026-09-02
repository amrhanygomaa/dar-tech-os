import { createHash, randomBytes } from 'node:crypto';
import type {
  InvitationSecretGenerator,
  InvitationSecretMaterial,
} from './invitation.contracts.js';
import { invalidInvitationSecret } from './invitation.errors.js';

const invitationSecretPattern = /^[A-Za-z0-9_-]{43}$/u;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export class CryptographicInvitationSecretGenerator implements InvitationSecretGenerator {
  generate(): InvitationSecretMaterial {
    const secret = randomBytes(32).toString('base64url');
    return { secret, hash: sha256(secret) };
  }

  hash(secret: string): string {
    if (!invitationSecretPattern.test(secret)) throw invalidInvitationSecret();
    const decoded = Buffer.from(secret, 'base64url');
    if (decoded.length !== 32) throw invalidInvitationSecret();
    return sha256(secret);
  }
}
