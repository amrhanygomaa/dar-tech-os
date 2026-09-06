'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, apiData, requestError } from '../../../lib/api';

interface Binding {
  readonly id: string;
  readonly permissionKey: string;
  readonly riskClassification: string;
  readonly scopeType: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
}
interface Grant {
  readonly id: string;
  readonly requesterSnapshot: Record<string, string>;
  readonly recipientSnapshot: Record<string, string>;
  readonly recipientEmployeeId: string;
  readonly reason: string;
  readonly requestedRisk: string;
  readonly effectiveRisk: string;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly activatedAt: string | null;
  readonly status: string;
  readonly storedStatus: string;
  readonly approvalReference: string | null;
  readonly approvalStatus: string | null;
  readonly approvalExecutionState: string | null;
  readonly stepUpAssuranceLevel: string;
  readonly stepUpVerifiedAt: string;
  readonly denialCode: string | null;
  readonly revokedAt: string | null;
  readonly canActivate: boolean;
  readonly canRevoke: boolean;
  readonly bindings: readonly Binding[];
  readonly history: readonly {
    readonly eventType: string;
    readonly outcome: string;
    readonly risk: string;
    readonly action: string | null;
    readonly resourceType: string | null;
    readonly resourceId: string | null;
    readonly occurredAt: string;
  }[];
}
interface Page { readonly items: readonly Grant[]; readonly total: number }

export default function EmergencyAccessPage() {
  const [items, setItems] = useState<readonly Grant[]>([]);
  const [selected, setSelected] = useState<Grant | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [recipientId, setRecipientId] = useState('');
  const [reason, setReason] = useState('');
  const [risk, setRisk] = useState('CRITICAL');
  const [permissionKey, setPermissionKey] = useState('admin.employee.read');
  const [scopeType, setScopeType] = useState('ORGANIZATION');
  const [resourceType, setResourceType] = useState('employee');
  const [resourceId, setResourceId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiData<Page>(await fetch(`${API_BASE_URL}/emergency-access?page=1&pageSize=25`, { credentials: 'include', cache: 'no-store' }));
      setItems(result.items);
      setMessage('');
    } catch (error) {
      setItems([]);
      setSelected(null);
      setMessage(requestError(error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const countdown = useMemo(() => {
    if (!selected || selected.status !== 'ACTIVE') return null;
    const seconds = Math.max(0, Math.ceil((new Date(selected.expiresAt).getTime() - now) / 1000));
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s remaining`;
  }, [selected, now]);

  async function detail(id: string) {
    try {
      setSelected(await apiData<Grant>(await fetch(`${API_BASE_URL}/emergency-access/${id}`, { credentials: 'include', cache: 'no-store' })));
    } catch (error) {
      setMessage(requestError(error).message);
    }
  }

  async function request(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const grant = await apiData<Grant>(await fetch(`${API_BASE_URL}/emergency-access/requests`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          recipientEmployeeId: recipientId,
          reason,
          risk,
          startsAt: new Date(startsAt).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
          bindings: [{ permissionKey, scopeType, resourceType, ...(scopeType === 'ORGANIZATION' ? {} : { resourceId }) }],
        }),
      }));
      setSelected(grant);
      setMessage('Emergency request recorded. Approval never activates access automatically.');
      await load();
    } catch (error) {
      setMessage(requestError(error).message);
    } finally {
      setBusy(false);
    }
  }

  async function command(command: 'activate' | 'revoke') {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const result = await apiData<{ grant: Grant }>(await fetch(`${API_BASE_URL}/emergency-access/${selected.id}/${command}`, { method: 'POST', credentials: 'include' }));
      setSelected(result.grant);
      setMessage(command === 'activate' ? 'Emergency access explicitly activated.' : 'Emergency access revoked immediately.');
      await load();
      await detail(result.grant.id);
    } catch (error) {
      setMessage(requestError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="workspace-main">
    <header className="workspace-header"><div><p className="eyebrow">High-priority security control</p><h1>Emergency access</h1><p className="lede">Exceptional, exact, time-limited authority. This is not Super Admin, standing access, or a bypass.</p></div><button className="button secondary" onClick={() => void load()} disabled={loading}>Refresh</button></header>
    <p className="error-banner" role="note">Every request requires trusted step-up and a configured emergency policy. Approval alone never activates access.</p>
    {message ? <p className="error-banner" role="status">{message}</p> : null}
    <div className="workspace-grid">
      <section className="panel"><div className="panel-heading"><h2>Request emergency authority</h2><p className="muted">Requester and organization come only from the signed-in session.</p></div>
        <form onSubmit={(event) => void request(event)} className="invitation-list">
          <label>Recipient employee ID<input required value={recipientId} onChange={(event) => setRecipientId(event.target.value)} /></label>
          <label>Emergency reason<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <label>Requested risk<select value={risk} onChange={(event) => setRisk(event.target.value)}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Permission key<input required value={permissionKey} onChange={(event) => setPermissionKey(event.target.value)} /></label>
          <label>Scope<select value={scopeType} onChange={(event) => setScopeType(event.target.value)}>{['ORGANIZATION', 'EXPLICIT', 'ASSIGNED', 'TEAM', 'DEPARTMENT', 'PROJECT', 'CUSTOMER'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Resource type<input required value={resourceType} onChange={(event) => setResourceType(event.target.value)} /></label>
          {scopeType !== 'ORGANIZATION' ? <label>Exact resource ID<input required value={resourceId} onChange={(event) => setResourceId(event.target.value)} /></label> : null}
          <label>Requested start<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
          <label>Mandatory expiry<input required type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
          <button className="button primary" disabled={busy}>Create controlled request</button>
        </form>
      </section>
      <section className="panel"><div className="panel-heading"><h2>Emergency history</h2><p className="muted">{loading ? 'Loading…' : `${items.length} of the latest records`}</p></div>
        <div className="invitation-list">{items.map((grant) => <button className="approval-row" key={grant.id} onClick={() => void detail(grant.id)}><span><strong>{grant.recipientSnapshot.displayName ?? 'Employee'}</strong><small>{grant.effectiveRisk} · expires {new Date(grant.expiresAt).toLocaleString()}</small></span><span className={`pill ${grant.status.toLowerCase()}`}>{grant.status}</span></button>)}{!loading && items.length === 0 ? <p className="empty-state">No emergency records are visible.</p> : null}</div>
      </section>
    </div>
    <section className="panel">{selected ? <><div className="panel-heading"><p className="eyebrow">{selected.status} · {selected.effectiveRisk}</p><h2>Emergency record</h2><p className="muted">Requester {selected.requesterSnapshot.displayName ?? 'Employee'} · recipient {selected.recipientSnapshot.displayName ?? 'Employee'}</p></div><p><strong>Reason:</strong> {selected.reason}</p><p>Requested risk {selected.requestedRisk}; server-effective risk {selected.effectiveRisk}.</p><p>Window {new Date(selected.startsAt).toLocaleString()} → {new Date(selected.expiresAt).toLocaleString()}</p>{countdown ? <p className="error-banner" role="timer">{countdown}</p> : null}<p>Approval: {selected.approvalStatus ?? 'step-up-only policy'} · execution {selected.approvalExecutionState ?? 'not applicable'}</p><p>Trusted step-up: {selected.stepUpAssuranceLevel} at {new Date(selected.stepUpVerifiedAt).toLocaleString()}</p><h3>Exact approved bindings</h3><div className="invitation-list">{selected.bindings.map((binding) => <div className="invitation-row" key={binding.id}><span><strong>{binding.permissionKey}</strong><small>{binding.scopeType} · {binding.resourceType}{binding.resourceId ? ` / ${binding.resourceId}` : ''} · {binding.riskClassification}</small></span></div>)}</div><h3>Safe lifecycle and material-use history</h3><div className="invitation-list">{selected.history.map((entry, index) => <div className="invitation-row" key={`${entry.eventType}-${entry.occurredAt}-${index}`}><span><strong>{entry.eventType}</strong><small>{new Date(entry.occurredAt).toLocaleString()} · {entry.outcome} · {entry.risk}{entry.action ? ` · ${entry.action}` : ''}{entry.resourceType ? ` · ${entry.resourceType}${entry.resourceId ? ` / ${entry.resourceId}` : ''}` : ''}</small></span></div>)}{selected.history.length === 0 ? <p className="empty-state">No lifecycle evidence is available in this response.</p> : null}</div><div className="row-actions">{selected.canActivate ? <button className="button primary" disabled={busy} onClick={() => void command('activate')}>Activate after revalidation</button> : null}{selected.canRevoke ? <button className="button secondary danger" disabled={busy} onClick={() => void command('revoke')}>Revoke immediately</button> : null}</div><p className="muted">Material emergency use is attributed to this exact grant and retained in T12 audit/security history. Denied, expired, and revoked authority cannot be used.</p></> : <p className="empty-state">Select a record to inspect its policy, step-up, exact scope, activation state, and evidence boundary.</p>}</section>
  </main>;
}
