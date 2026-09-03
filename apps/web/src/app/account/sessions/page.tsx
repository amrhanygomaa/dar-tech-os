'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, apiData, requestError } from '../../../lib/api';

interface SessionView {
  readonly id: string;
  readonly current: boolean;
  readonly clientKind: 'browser';
  readonly assuranceLevel: string | null;
  readonly authenticatedAt: string | null;
  readonly issuedAt: string;
  readonly lastSeenAt: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly revokedAt: string | null;
  readonly status: 'ACTIVE' | 'REVOKED' | 'IDLE_EXPIRED' | 'ABSOLUTE_EXPIRED' | 'INACTIVE';
}

type PageState = 'loading' | 'ready' | 'unauthenticated' | 'error' | 'result';

export default function AccountSessionsPage() {
  const [state, setState] = useState<PageState>('loading');
  const [sessions, setSessions] = useState<readonly SessionView[]>([]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const items = await apiData<SessionView[]>(
        await fetch(`${API_BASE_URL}/me/sessions`, {
          credentials: 'include',
          cache: 'no-store',
        }),
      );
      setSessions(items);
      setState('ready');
    } catch (error) {
      const failure = requestError(error);
      setMessage(failure.message);
      setState(failure.status === 401 ? 'unauthenticated' : 'error');
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function revoke(session: SessionView) {
    if (!window.confirm(`Revoke this ${session.current ? 'current' : 'other'} session?`)) return;
    setSubmitting(true);
    try {
      const result = await apiData<{ currentSessionRevoked: boolean }>(
        await fetch(`${API_BASE_URL}/me/sessions/${encodeURIComponent(session.id)}/revoke`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      );
      if (result.currentSessionRevoked) {
        setSessions([]);
        setMessage('You are signed out.');
        setState('unauthenticated');
      } else {
        setMessage('Session revoked.');
        setState('result');
        await load();
      }
    } catch (error) {
      setMessage(requestError(error).message);
      setState('error');
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeAll(includeCurrent: boolean) {
    const label = includeCurrent ? 'all sessions and sign out' : 'all other sessions';
    if (!window.confirm(`Revoke ${label}?`)) return;
    setSubmitting(true);
    try {
      const result = await apiData<{ revokedCount: number; currentSessionRevoked: boolean }>(
        await fetch(`${API_BASE_URL}/me/sessions/revoke-all`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ includeCurrent }),
        }),
      );
      setMessage(`${result.revokedCount} session${result.revokedCount === 1 ? '' : 's'} revoked.`);
      if (result.currentSessionRevoked) {
        setSessions([]);
        setState('unauthenticated');
      } else {
        setState('result');
        await load();
      }
    } catch (error) {
      setMessage(requestError(error).message);
      setState('error');
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'unauthenticated') {
    return <main className="workspace-main"><section className="state-card"><p className="eyebrow">Session required</p><h1>You are signed out</h1><p className="lede">{message || 'Sign in to manage your sessions.'}</p><a className="button primary" href="/">Return to sign in</a></section></main>;
  }

  return (
    <main className="workspace-main">
      <header className="workspace-header">
        <div><p className="eyebrow">Account security</p><h1>Your sessions</h1><p className="lede">Review current and historical browser sessions without exposing credentials or device fingerprints.</p></div>
        <div className="header-links"><button className="button secondary" disabled={submitting} onClick={() => void revokeAll(false)}>Revoke all others</button><button className="button primary" disabled={submitting} onClick={() => void revokeAll(true)}>Sign out everywhere</button></div>
      </header>
      <section className="panel" aria-live="polite">
        {state === 'loading' ? <p className="muted" role="status">Loading sessions…</p> : null}
        {state === 'error' ? <p className="error-banner" role="alert">{message}</p> : null}
        {state === 'result' ? <p className="secret-delivery" role="status">{message}</p> : null}
        {state === 'ready' && sessions.length === 0 ? <p className="empty-state">No session history is available.</p> : null}
        <div className="invitation-list">
          {sessions.map((session) => (
            <article className="invitation-row" key={session.id}>
              <div><strong>{session.current ? 'Current browser session' : 'Browser session'}</strong><p>Last activity {new Date(session.lastSeenAt).toLocaleString()}</p><p>Idle expiry {new Date(session.idleExpiresAt).toLocaleString()} · Absolute expiry {new Date(session.absoluteExpiresAt).toLocaleString()}</p><p>Assurance {session.assuranceLevel ?? 'not supplied'} · Authenticated {session.authenticatedAt ? new Date(session.authenticatedAt).toLocaleString() : 'time not supplied'}</p></div>
              <div className="row-actions"><span className={`pill ${session.status.toLowerCase()}`}>{session.status}</span>{session.status === 'ACTIVE' ? <button className="text-link danger button-link" disabled={submitting} onClick={() => void revoke(session)}>Revoke</button> : null}</div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
