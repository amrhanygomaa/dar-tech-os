import { describe, expect, it } from 'vitest';
import { CryptographicInvitationSecretGenerator } from './invitation-secret.js';

describe('invitation secret security', () => {
  it('generates unique 256-bit secrets and stores only deterministic SHA-256 lookup digests', () => {
    const generator = new CryptographicInvitationSecretGenerator();
    const generated = Array.from({ length: 32 }, () => generator.generate());
    expect(new Set(generated.map(({ secret }) => secret)).size).toBe(32);
    for (const material of generated) {
      expect(Buffer.from(material.secret, 'base64url')).toHaveLength(32);
      expect(material.secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(material.hash).toMatch(/^[0-9a-f]{64}$/u);
      expect(generator.hash(material.secret)).toBe(material.hash);
      expect(material.hash).not.toContain(material.secret);
    }
  });

  it('rejects malformed or low-entropy presented secrets', () => {
    const generator = new CryptographicInvitationSecretGenerator();
    for (const invalid of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), '?'.repeat(43)]) {
      expect(() => generator.hash(invalid)).toThrowError(
        expect.objectContaining({ code: 'INVITATION_INVALID' }),
      );
    }
  });
});
