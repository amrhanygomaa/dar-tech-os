'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, apiData } from '../../../../lib/api';

export default function OnboardingCallbackPage({
  params,
}: {
  readonly params: Promise<{ providerKey: string }>;
}) {
  const [state, setState] = useState<'working' | 'complete' | 'failed'>('working');

  useEffect(() => {
    void params.then(async ({ providerKey }) => {
      const query = new URLSearchParams(window.location.search);
      const body = {
        transactionId: query.get('transactionId'),
        state: query.get('state'),
        nonce: query.get('nonce'),
        code: query.get('code'),
        error: query.get('error'),
      };
      window.history.replaceState(null, '', '/onboarding');
      try {
        await apiData(
          await fetch(
            `${API_BASE_URL}/onboarding/auth/${encodeURIComponent(providerKey)}/callback`,
            {
              method: 'POST',
              cache: 'no-store',
              referrerPolicy: 'no-referrer',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(
                Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null)),
              ),
            },
          ),
        );
        setState('complete');
      } catch {
        setState('failed');
      }
    });
  }, [params]);

  return (
    <main className="onboarding-main">
      <section className="onboarding-card" aria-live="polite">
        <div className="brand-lockup">
          <span>DT</span>
          <p>Dar Tech OS</p>
        </div>
        <p className="eyebrow">Employee onboarding</p>
        <h1>
          {state === 'working'
            ? 'Completing onboarding'
            : state === 'complete'
              ? 'Your account is ready'
              : 'Authentication could not be completed'}
        </h1>
        <p className="lede">
          {state === 'working'
            ? 'We are atomically linking your verified identity and activating your account.'
            : state === 'complete'
              ? 'Your verified identity is linked. Application sign-in will be available when secure session issuance is enabled.'
              : 'No account changes were committed. Ask for help or restart with a valid invitation.'}
        </p>
        {state === 'failed' ? (
          <a className="button secondary" href="/onboarding">
            Return to onboarding
          </a>
        ) : null}
        <footer className="security-note">
          No application session, bearer token, refresh token, or persistent login cookie was
          created.
        </footer>
      </section>
    </main>
  );
}
