'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, apiData, requestError } from '../../../lib/api';

interface Invitation {
  readonly id: string;
  readonly invitedEmailNormalized: string;
  readonly status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  readonly issuedAt: string;
  readonly expiresAt: string;
}
interface InvitationPage {
  readonly items: readonly Invitation[];
  readonly total: number;
}

type PageState = 'loading' | 'ready' | 'unauthorized' | 'forbidden' | 'error';

export default function InvitationAdministrationPage() {
  const [items, setItems] = useState<readonly Invitation[]>([]);
  const [state, setState] = useState<PageState>('loading');
  const [message, setMessage] = useState('');
  const [oneTimeUrl, setOneTimeUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await apiData<InvitationPage>(
        await fetch(`${API_BASE_URL}/invitations?page=1&pageSize=50`, {
          credentials: 'include',
          cache: 'no-store',
        }),
      );
      setItems(result.items);
      setState('ready');
    } catch (error) {
      const failure = requestError(error);
      setMessage(
        failure.requestId
          ? `${failure.message} · Request ${failure.requestId}`
          : failure.message,
      );
      setState(
        failure.status === 401
          ? 'unauthorized'
          : failure.status === 403
            ? 'forbidden'
            : 'error',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setOneTimeUrl(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiData<{ invitation: Invitation; acceptanceUrl: string }>(
        await fetch(`${API_BASE_URL}/employees/invite`, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeCode: form.get('employeeCode'),
            firstName: form.get('firstName'),
            lastName: form.get('lastName'),
            displayName: form.get('displayName'),
            workEmail: form.get('workEmail'),
          }),
        }),
      );
      setOneTimeUrl(result.acceptanceUrl);
      setItems((current) => [result.invitation, ...current]);
      event.currentTarget.reset();
      setState('ready');
    } catch (error) {
      const failure = requestError(error);
      setMessage(failure.message);
      setState(
        failure.status === 401
          ? 'unauthorized'
          : failure.status === 403
            ? 'forbidden'
            : 'error',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    setSubmitting(true);
    try {
      const result = await apiData<Invitation>(
        await fetch(`${API_BASE_URL}/invitations/${id}/revoke`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      );
      setItems((current) => current.map((item) => (item.id === id ? result : item)));
    } catch (error) {
      setMessage(requestError(error).message);
      setState('error');
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'unauthorized' || state === 'forbidden') {
    return (
      <main className="workspace-main">
        <section className="state-card" role="alert">
          <span className="status-mark">Access controlled</span>
          <h1>
            {state === 'unauthorized'
              ? 'Trusted authentication is required'
              : 'You do not have this permission'}
          </h1>
          <p>{message}</p>
          <button className="button secondary" onClick={() => void load()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-main">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Identity administration</p>
          <h1>Employee invitations</h1>
          <p className="lede">
            Issue, monitor, and revoke invitation-only access within your organization.
          </p>
        </div>
        <a className="text-link" href="/">
          Portal home
        </a>
      </header>

      <div className="workspace-grid">
        <section className="panel" aria-labelledby="invite-form-title">
          <div className="panel-heading">
            <p className="eyebrow">New invitation</p>
            <h2 id="invite-form-title">Invite an employee</h2>
          </div>
          <form className="form-grid" onSubmit={(event) => void issue(event)}>
            <label>
              Employee code
              <input name="employeeCode" required maxLength={64} />
            </label>
            <div className="split-fields">
              <label>
                First name
                <input name="firstName" required maxLength={100} />
              </label>
              <label>
                Last name
                <input name="lastName" required maxLength={100} />
              </label>
            </div>
            <label>
              Display name
              <input name="displayName" required maxLength={160} />
            </label>
            <label>
              Work email
              <input name="workEmail" type="email" required maxLength={320} />
            </label>
            <button className="button primary" disabled={submitting}>
              {submitting ? 'Working…' : 'Issue invitation'}
            </button>
          </form>
          {oneTimeUrl ? (
            <div className="secret-delivery" role="status">
              <strong>One-time delivery</strong>
              <p>Share this URL securely now. It cannot be retrieved later.</p>
              <code>{oneTimeUrl}</code>
              <button
                className="text-link button-link"
                onClick={() => setOneTimeUrl(null)}
              >
                Clear from view
              </button>
            </div>
          ) : null}
        </section>

        <section
          className="panel list-panel"
          aria-labelledby="invitation-list-title"
          aria-busy={state === 'loading'}
        >
          <div className="panel-heading row-heading">
            <div>
              <p className="eyebrow">Organization scope</p>
              <h2 id="invitation-list-title">Recent invitations</h2>
            </div>
            <button className="text-link button-link" onClick={() => void load()}>
              Refresh
            </button>
          </div>
          {state === 'loading' ? (
            <p className="muted" role="status">
              Loading invitations…
            </p>
          ) : null}
          {state === 'error' ? (
            <p className="error-banner" role="alert">
              {message}
            </p>
          ) : null}
          {state === 'ready' && items.length === 0 ? (
            <p className="empty-state">No invitations have been issued.</p>
          ) : null}
          <div className="invitation-list">
            {items.map((invitation) => (
              <article className="invitation-row" key={invitation.id}>
                <div>
                  <strong>{invitation.invitedEmailNormalized}</strong>
                  <p>Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
                </div>
                <div className="row-actions">
                  <span className={`pill ${invitation.status.toLowerCase()}`}>
                    {invitation.status}
                  </span>
                  {invitation.status === 'PENDING' ? (
                    <button
                      className="text-link danger button-link"
                      disabled={submitting}
                      onClick={() => void revoke(invitation.id)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
