'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, apiData } from '../../../../lib/api';

export default function OnboardingCallbackPage({
  params,
}: {
  readonly params: Promise<{ providerKey: string }>;
}) {
  const [state, setState] = useState<'working' | 'complete' | 'sign-in-required' | 'failed'>('working');

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
        const completed = await apiData<{
          sessionCreated: boolean;
          nextStep: 'SESSION_ESTABLISHED' | 'SIGN_IN_REQUIRED';
        }>(
          await fetch(
            `${API_BASE_URL}/onboarding/auth/${encodeURIComponent(providerKey)}/callback`,
            {
              method: 'POST',
              credentials: 'include',
              cache: 'no-store',
              referrerPolicy: 'no-referrer',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(
                Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null)),
              ),
            },
          ),
        );
        if (completed.sessionCreated && completed.nextStep === 'SESSION_ESTABLISHED') {
          setState('complete');
          window.location.assign('/account/sessions');
        } else {
          setState('sign-in-required');
        }
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
              : state === 'sign-in-required'
                ? 'Your account is ready — sign in required'
              : 'Authentication could not be completed'}
        </h1>
        <p className="lede">
          {state === 'working'
            ? 'We are atomically linking your verified identity and activating your account.'
            : state === 'complete'
              ? 'Your verified identity is linked and your secure application session is ready.'
              : state === 'sign-in-required'
                ? 'Onboarding is complete, but a session could not be created. Sign in normally; the invitation has already been used.'
              : 'No account changes were committed. Ask for help or restart with a valid invitation.'}
        </p>
        {state === 'failed' ? (
          <a className="button secondary" href="/onboarding">
            Return to onboarding
          </a>
        ) : null}
        {state === 'sign-in-required' ? (
          <a className="button primary" href="/">
            Continue to sign in
          </a>
        ) : null}
        <footer className="security-note">
          Dar Tech uses an opaque HttpOnly application-session cookie and never stores session
          credentials in browser storage.
        </footer>
      </section>
    </main>
  );
}
