import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const onboardingSource = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
const callbackSource = readFileSync(
  fileURLToPath(new URL('./callback/[providerKey]/page.tsx', import.meta.url)),
  'utf8',
);
const administrationSource = readFileSync(
  fileURLToPath(new URL('../admin/invitations/page.tsx', import.meta.url)),
  'utf8',
);

describe('S02-T02 browser secret handling', () => {
  it('reads the invitation from the fragment, scrubs the URL before calling the API, and posts it in a body', () => {
    const readIndex = onboardingSource.indexOf('window.location.hash.slice(1)');
    const scrubIndex = onboardingSource.indexOf('window.history.replaceState');
    const requestIndex = onboardingSource.indexOf('/onboarding/invitation/inspect');
    expect(readIndex).toBeGreaterThan(-1);
    expect(scrubIndex).toBeGreaterThan(readIndex);
    expect(requestIndex).toBeGreaterThan(scrubIndex);
    expect(onboardingSource).toContain('body: JSON.stringify({ invitationToken: secret })');
    expect(onboardingSource).toMatch(/referrerPolicy:\s*["']no-referrer["']/u);
  });

  it('never persists or logs the invitation and clears component state before provider redirect', () => {
    const combined = `${onboardingSource}\n${callbackSource}`;
    expect(combined).not.toMatch(/localStorage|sessionStorage|console\.|document\.cookie/iu);
    expect(combined).not.toMatch(/analytics|telemetry/iu);
    expect(onboardingSource.indexOf('setInvitationToken(null);')).toBeLessThan(
      onboardingSource.indexOf('window.location.assign'),
    );
  });

  it('scrubs provider protocol values before submitting the callback and promises no session', () => {
    const readIndex = callbackSource.indexOf('window.location.search');
    const scrubIndex = callbackSource.indexOf('window.history.replaceState');
    const requestIndex = callbackSource.indexOf('/callback`');
    expect(readIndex).toBeGreaterThan(-1);
    expect(scrubIndex).toBeGreaterThan(readIndex);
    expect(requestIndex).toBeGreaterThan(scrubIndex);
    expect(callbackSource).toContain('opaque HttpOnly application-session cookie');
    expect(callbackSource).toContain("nextStep: 'SESSION_ESTABLISHED' | 'SIGN_IN_REQUIRED'");
  });

  it('renders every required public and administrative state without a password or signup flow', () => {
    expect(onboardingSource).toMatch(/invalid|expired|revoked|superseded|used|redirecting|auth-failed/u);
    expect(callbackSource).toMatch(/working.*complete.*failed/su);
    expect(administrationSource).toMatch(/loading.*ready.*unauthorized.*forbidden.*error/su);
    expect(administrationSource).toContain('No invitations have been issued.');
    expect(`${onboardingSource}\n${callbackSource}\n${administrationSource}`).not.toMatch(
      /password|sign[ -]?up|customer/iu,
    );
  });

  it('renders resend, re-invite, copy, one-time delivery, and superseded guidance', () => {
    expect(administrationSource).toContain('Resend invitation');
    expect(administrationSource).toContain('Re-invite');
    expect(administrationSource).toContain('navigator.clipboard.writeText');
    expect(administrationSource).toMatch(/No email was\s+sent/u);
    expect(onboardingSource).toContain('A newer invitation has been issued');
    expect(onboardingSource).toContain('Use the most recent invitation link you received.');
  });
});
