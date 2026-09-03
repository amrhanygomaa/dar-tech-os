'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { API_BASE_URL, apiData, requestError } from '../../../lib/api';

interface AdminSession {
  readonly id: string;
  readonly employeeId: string;
  readonly userAccountId: string;
  readonly current: boolean;
  readonly clientKind: 'browser';
  readonly lastSeenAt: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly status: string;
}

interface SessionPage { readonly items: readonly AdminSession[]; readonly page: number; readonly pageSize: number; readonly total: number }
type State = 'loading' | 'ready' | 'unauthorized' | 'forbidden' | 'not-found' | 'error';

export default function AdminSessionsPage() {
  const [state, setState] = useState<State>('loading');
  const [page, setPage] = useState<SessionPage>({ items: [], page: 1, pageSize: 25, total: 0 });
  const [message, setMessage] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (employeeId = '') => {
    setState('loading');
    const query = new URLSearchParams({ page: '1', pageSize: '25' });
    if (employeeId) query.set('employeeId', employeeId);
    try {
      setPage(await apiData<SessionPage>(await fetch(`${API_BASE_URL}/admin/sessions?${query}`, { credentials: 'include', cache: 'no-store' })));
      setState('ready');
    } catch (error) {
      const failure = requestError(error);
      setMessage(failure.message);
      setState(failure.status === 401 ? 'unauthorized' : failure.status === 403 ? 'forbidden' : failure.status === 404 ? 'not-found' : 'error');
    }
  }, []);

  useEffect(() => void load(), [load]);

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(employeeFilter.trim());
  }

  async function command(path: string, body: unknown) {
    setSubmitting(true);
    try {
      await apiData(await fetch(`${API_BASE_URL}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      await load(employeeFilter.trim());
    } catch (error) {
      const failure = requestError(error);
      setMessage(failure.message);
      setState(failure.status === 401 ? 'unauthorized' : failure.status === 403 ? 'forbidden' : failure.status === 404 ? 'not-found' : 'error');
    } finally { setSubmitting(false); }
  }

  return (
    <main className="workspace-main">
      <header className="workspace-header"><div><p className="eyebrow">Fail-closed administration</p><h1>Organization sessions</h1><p className="lede">Safe metadata only. Production access remains denied until the central authorization ticket supplies a decision.</p></div></header>
      <div className="workspace-grid">
        <section className="panel"><div className="panel-heading"><h2>Filter by employee</h2></div><form className="form-grid" onSubmit={filter}><label>Employee ID<input value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} /></label><button className="button primary" disabled={submitting}>Apply filter</button></form></section>
        <section className="panel" aria-live="polite">
          {state === 'loading' ? <p className="muted" role="status">Loading sessions…</p> : null}
          {state === 'unauthorized' ? <p className="error-banner">Authentication is required.</p> : null}
          {state === 'forbidden' ? <p className="error-banner">Session administration is not authorized.</p> : null}
          {state === 'not-found' ? <p className="error-banner">The requested employee or session was not found.</p> : null}
          {state === 'error' ? <p className="error-banner">{message}</p> : null}
          {state === 'ready' && page.items.length === 0 ? <p className="empty-state">No sessions match this organization-scoped view.</p> : null}
          <div className="invitation-list">{page.items.map((session) => <article className="invitation-row" key={session.id}><div><strong>{session.current ? 'Current session' : 'Browser session'}</strong><p>Employee {session.employeeId}</p><p>Last activity {new Date(session.lastSeenAt).toLocaleString()} · Expires {new Date(session.absoluteExpiresAt).toLocaleString()}</p></div><div className="row-actions"><span className={`pill ${session.status.toLowerCase()}`}>{session.status}</span>{session.status === 'ACTIVE' ? <button className="text-link danger button-link" disabled={submitting} onClick={() => void command(`/admin/sessions/${session.id}/revoke`, {})}>Revoke</button> : null}<button className="text-link danger button-link" disabled={submitting} onClick={() => void command(`/employees/${session.employeeId}/sessions/revoke-all`, { includeCurrent: false })}>Revoke employee sessions</button></div></article>)}</div>
        </section>
      </div>
    </main>
  );
}
