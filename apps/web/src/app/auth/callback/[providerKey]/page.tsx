'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, apiData } from '../../../../lib/api';

export default function AuthenticationCallbackPage({
  params,
}: {
  readonly params: Promise<{ providerKey: string }>;
}) {
  const [state, setState] = useState<'working' | 'failed'>('working');

  useEffect(() => {
    void params.then(async ({ providerKey }) => {
      const query = new URLSearchParams(window.location.search);
      const body = Object.fromEntries(
        ['transactionId', 'state', 'nonce', 'code', 'error']
          .map((key) => [key, query.get(key)] as const)
          .filter((entry): entry is readonly [string, string] => entry[1] !== null),
      );
      window.history.replaceState(null, '', '/');
      try {
        const completed = await apiData<{
          sessionCreated: true;
          nextStep: 'SESSION_ESTABLISHED';
        }>(
          await fetch(`${API_BASE_URL}/auth/${encodeURIComponent(providerKey)}/callback`, {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
        if (!completed.sessionCreated || completed.nextStep !== 'SESSION_ESTABLISHED') {
          throw new Error('Session establishment failed');
        }
        window.location.assign('/account/sessions');
      } catch {
        setState('failed');
      }
    });
  }, [params]);

  return (
    <main className="onboarding-main">
      <section className="onboarding-card" aria-live="polite">
        <p className="eyebrow">Secure sign in</p>
        <h1>{state === 'working' ? 'Establishing your session' : 'Sign in could not be completed'}</h1>
        <p className="lede">
          {state === 'working'
            ? 'Your provider identity is verified before an opaque application session is created.'
            : 'Restart sign in. No session credential was exposed to this page.'}
        </p>
        {state === 'failed' ? <a className="button secondary" href="/">Return home</a> : null}
      </section>
    </main>
  );
}
