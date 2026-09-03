import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const accountSource = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
const adminSource = readFileSync(
  fileURLToPath(new URL('../../admin/sessions/page.tsx', import.meta.url)),
  'utf8',
);
const authenticationCallbackSource = readFileSync(
  fileURLToPath(new URL('../../auth/callback/[providerKey]/page.tsx', import.meta.url)),
  'utf8',
);
const onboardingCallbackSource = readFileSync(
  fileURLToPath(new URL('../../onboarding/callback/[providerKey]/page.tsx', import.meta.url)),
  'utf8',
);
const signInSource = readFileSync(
  fileURLToPath(new URL('../../page.tsx', import.meta.url)),
  'utf8',
);

describe('S02-T04 session management frontend boundary', () => {
  it('uses credentialed cookie requests without reading or persisting the HttpOnly credential', () => {
    const combined = `${accountSource}\n${adminSource}\n${authenticationCallbackSource}\n${onboardingCallbackSource}`;
    expect(combined).toMatch(/credentials:\s*['"]include['"]/u);
    expect(combined).not.toMatch(/localStorage|sessionStorage|document\.cookie|credentialHash|sessionSecret/iu);
  });

  it('supports self list, single revoke, revoke-all-others, and sign-out-everywhere states', () => {
    expect(accountSource).toContain('`${API_BASE_URL}/me/sessions`');
    expect(accountSource).toContain('/me/sessions/${encodeURIComponent(session.id)}/revoke`');
    expect(accountSource).toContain('/me/sessions/revoke-all`');
    expect(accountSource).toContain('revokeAll(false)');
    expect(accountSource).toContain('revokeAll(true)');
    expect(accountSource).toMatch(/loading.*ready.*unauthenticated.*error/su);
    expect(accountSource).toContain('No session history is available.');
    expect(accountSource).toMatch(/Current browser session.*Last activity.*Idle expiry.*Absolute expiry/su);
  });

  it('keeps administration bounded, fail closed, and explicit about every response state', () => {
    expect(adminSource).toContain('/admin/sessions?${query}');
    expect(adminSource).toContain('/admin/sessions/${session.id}/revoke`');
    expect(adminSource).toContain('/employees/${session.employeeId}/sessions/revoke-all`');
    expect(adminSource).toContain("pageSize: '25'");
    expect(adminSource).toMatch(/loading.*ready.*unauthorized.*forbidden.*not-found.*error/su);
    expect(adminSource).toContain('No sessions match this organization-scoped view.');
    expect(adminSource).toContain('Production access remains denied');
    expect(adminSource).not.toMatch(/Founder|job.?title|role.?name/iu);
  });

  it('handles successful sign-in and irreversible onboarding recovery without invitation reuse', () => {
    expect(signInSource).toContain('`${API_BASE_URL}/auth/providers`');
    expect(signInSource).toContain('/auth/${encodeURIComponent(provider.key)}/start`');
    expect(signInSource).toContain('/auth/callback/${encodeURIComponent(provider.key)}`');
    expect(signInSource).toMatch(/loading.*ready.*redirecting.*error/su);
    expect(signInSource).not.toMatch(/password|sign[ -]?up/iu);
    expect(authenticationCallbackSource).toContain("nextStep: 'SESSION_ESTABLISHED'");
    expect(authenticationCallbackSource).toContain("window.location.assign('/account/sessions')");
    expect(onboardingCallbackSource).toContain("nextStep: 'SESSION_ESTABLISHED' | 'SIGN_IN_REQUIRED'");
    expect(onboardingCallbackSource).toContain('Onboarding is complete, but a session could not be created.');
    expect(onboardingCallbackSource).toContain('the invitation has already been used');
    expect(onboardingCallbackSource).not.toMatch(/reuse (the |your )?invitation/iu);
  });
});
