'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, apiData } from '../lib/api';

interface Provider {
  readonly key: string;
  readonly displayName: string;
  readonly iconKey: string | null;
}

type SignInState = 'loading' | 'ready' | 'redirecting' | 'error';

export default function FoundationPage() {
  const [providers, setProviders] = useState<readonly Provider[]>([]);
  const [signInState, setSignInState] = useState<SignInState>('loading');

  useEffect(() => {
    void fetch(`${API_BASE_URL}/auth/providers`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => apiData<Provider[]>(response))
      .then((availableProviders) => {
        setProviders(availableProviders);
        setSignInState('ready');
      })
      .catch(() => setSignInState('error'));
  }, []);

  async function startSignIn(provider: Provider) {
    setSignInState('redirecting');
    try {
      const started = await apiData<{ authorizationUrl: string }>(
        await fetch(`${API_BASE_URL}/auth/${encodeURIComponent(provider.key)}/start`, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            redirectUri: `${window.location.origin}/auth/callback/${encodeURIComponent(provider.key)}`,
          }),
        }),
      );
      window.location.assign(started.authorizationUrl);
    } catch {
      setSignInState('error');
    }
  }

  return (
    <main className="shell-main">
      <section className="hero-card" aria-labelledby="foundation-title">
        <p className="eyebrow">Dar Tech OS · Identity foundation</p>
        <h1 id="foundation-title">Invitation-only access, built for controlled onboarding.</h1>
        <p className="lede">
          Employee access begins with an authorized invitation and a verified provider identity.
          Opaque server-side sessions keep browser access revocable without exposing credentials to application code.
        </p>
        <div className="provider-list" aria-live="polite">
          {signInState === 'loading' ? <p className="muted">Loading approved sign-in providers…</p> : null}
          {signInState === 'redirecting' ? <p className="muted">Opening your identity provider…</p> : null}
          {signInState === 'error' ? <p className="error-banner">Sign in is not available right now.</p> : null}
          {signInState === 'ready' && providers.length === 0 ? (
            <p className="empty-state">No authentication provider is currently available.</p>
          ) : null}
          {signInState === 'ready'
            ? providers.map((provider) => (
                <button
                  className="provider-button"
                  key={provider.key}
                  onClick={() => void startSignIn(provider)}
                >
                  <span className="provider-icon" aria-hidden="true">
                    {provider.displayName.slice(0, 1)}
                  </span>
                  <span>Sign in with {provider.displayName}</span>
                  <span aria-hidden="true">→</span>
                </button>
              ))
            : null}
        </div>
        <nav className="hero-actions" aria-label="Identity routes">
          <a className="button primary" href="/onboarding">Use an invitation</a>
          <a className="button secondary" href="/account/sessions">My sessions</a>
          <a className="button secondary" href="/admin/invitations">Manage invitations</a>
          <a className="button secondary" href="/admin/roles">Manage roles</a>
        </nav>
      </section>
    </main>
  );
}
