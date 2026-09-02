'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, apiData } from '../../lib/api';

interface Provider {
  readonly key: string;
  readonly displayName: string;
  readonly iconKey: string | null;
}
type OnboardingState =
  'reading' | 'invalid' | 'expired' | 'revoked' | 'superseded' | 'used' | 'ready' | 'redirecting' | 'auth-failed';

export default function OnboardingPage() {
  const [state, setState] = useState<OnboardingState>('reading');
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const [providers, setProviders] = useState<readonly Provider[]>([]);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const secret = fragment.get('invite');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!secret) {
      setState('invalid');
      return;
    }
    setInvitationToken(secret);
    void Promise.all([
      fetch(`${API_BASE_URL}/onboarding/invitation/inspect`, {
        method: 'POST',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationToken: secret }),
      }).then((response) =>
        apiData<{
          status: 'VALID' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED' | 'ALREADY_USED';
        }>(response),
      ),
      fetch(`${API_BASE_URL}/auth/providers`, {
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }).then((response) => apiData<Provider[]>(response)),
    ])
      .then(([inspection, availableProviders]) => {
        setProviders(availableProviders);
        if (inspection.status === 'VALID') {
          setState('ready');
          return;
        }
        setInvitationToken(null);
        setState(
          inspection.status === 'EXPIRED'
            ? 'expired'
            : inspection.status === 'REVOKED'
              ? 'revoked'
              : inspection.status === 'SUPERSEDED'
                ? 'superseded'
                : 'used',
        );
      })
      .catch(() => {
        setInvitationToken(null);
        setState('invalid');
      });
  }, []);

  async function start(provider: Provider) {
    if (!invitationToken) return;
    setState('redirecting');
    try {
      const started = await apiData<{ authorizationUrl: string }>(
        await fetch(`${API_BASE_URL}/onboarding/auth/${encodeURIComponent(provider.key)}/start`, {
          method: 'POST',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invitationToken,
            redirectUri: `${window.location.origin}/onboarding/callback/${encodeURIComponent(provider.key)}`,
          }),
        }),
      );
      setInvitationToken(null);
      window.location.assign(started.authorizationUrl);
    } catch {
      setInvitationToken(null);
      setState('auth-failed');
    }
  }

  const stateCopy: Record<Exclude<OnboardingState, 'ready' | 'redirecting'>, { title: string; text: string }> = {
    reading: {
      title: 'Validating your invitation',
      text: 'This should only take a moment.',
    },
    invalid: {
      title: 'This invitation is not available',
      text: 'Check the secure link you received or ask the invitation issuer for help.',
    },
    expired: {
      title: 'This invitation has expired',
      text: 'Ask an authorized administrator to issue a new invitation.',
    },
    revoked: {
      title: 'This invitation was revoked',
      text: 'Contact the invitation issuer if you believe this was unexpected.',
    },
    superseded: {
      title: 'A newer invitation has been issued',
      text: 'Use the most recent invitation link you received.',
    },
    used: {
      title: 'Onboarding is already complete',
      text: 'This one-time invitation cannot be used again.',
    },
    'auth-failed': {
      title: 'Authentication could not be completed',
      text: 'Request a new invitation or contact an administrator before trying again.',
    },
  };

  return (
    <main className="onboarding-main">
      <section className="onboarding-card" aria-live="polite">
        <div className="brand-lockup">
          <span>DT</span>
          <p>Dar Tech OS</p>
        </div>
        {state === 'ready' ? (
          <>
            <p className="eyebrow">Invitation verified</p>
            <h1>Verify your work identity</h1>
            <p className="lede">Choose an approved provider. Its verified email must match your invitation.</p>
            <div className="provider-list">
              {providers.length === 0 ? (
                <p className="empty-state">No authentication provider is currently available.</p>
              ) : (
                providers.map((provider) => (
                  <button className="provider-button" key={provider.key} onClick={() => void start(provider)}>
                    <span className="provider-icon" aria-hidden="true">
                      {provider.displayName.slice(0, 1)}
                    </span>
                    <span>Continue with {provider.displayName}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : state === 'redirecting' ? (
          <>
            <p className="eyebrow">Secure handoff</p>
            <h1>Opening your identity provider</h1>
            <p className="lede">Your invitation is bound to this one authentication attempt.</p>
          </>
        ) : (
          <>
            <p className="eyebrow">Employee onboarding</p>
            <h1>{stateCopy[state].title}</h1>
            <p className="lede">{stateCopy[state].text}</p>
          </>
        )}
        <footer className="security-note">
          Invitation secrets are removed from this browser URL immediately and are never stored in browser storage.
        </footer>
      </section>
    </main>
  );
}
