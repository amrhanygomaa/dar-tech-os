'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, apiData, requestError } from '../../../lib/api';

type Lifecycle = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING' | 'ARCHIVED';
type Cleanup = 'PENDING' | 'INCOMPLETE' | 'COMPLETED' | null;

interface Employee {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly workEmail: string;
  readonly lifecycleStatus: Lifecycle;
  readonly suspendedAt: string | null;
  readonly offboardingAt: string | null;
  readonly archivedAt: string | null;
  readonly offboardingReason: string | null;
  readonly offboardingApprovalReference: string | null;
  readonly offboardingCleanupStatus: Cleanup;
  readonly offboardingCleanupAttemptedAt: string | null;
  readonly offboardingCleanupCompletedAt: string | null;
  readonly offboardingCleanupFailureCode: string | null;
  readonly offboardingSessionsRevokedCount: number | null;
  readonly offboardingRolesEndedCount: number | null;
  readonly offboardingTemporaryAccessEndedCount: number | null;
  readonly offboardingEmergencyAccessEndedCount: number | null;
  readonly userAccount: { readonly authenticationEligible: boolean; readonly disabledAt: string | null } | null;
}

interface EmployeePage { readonly items: readonly Employee[]; readonly total: number }
interface CommandResult {
  readonly outcome: 'changed' | 'idempotent' | 'approval_required' | 'cleanup_incomplete' | 'cleanup_completed';
  readonly employee: Employee;
  readonly approvalReference: string | null;
  readonly securityBarrierActive: boolean;
  readonly historyPreserved: true;
}
type PageState = 'loading' | 'ready' | 'unauthorized' | 'forbidden' | 'conflict' | 'validation' | 'error';

function stateFor(status: number): PageState {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  return 'error';
}

function cleanupText(employee: Employee): string {
  if (employee.offboardingCleanupStatus === 'COMPLETED') return 'Access cleanup complete';
  if (employee.offboardingCleanupStatus === 'INCOMPLETE') return `Cleanup incomplete and retry-safe (${employee.offboardingCleanupFailureCode ?? 'bounded failure'})`;
  if (employee.offboardingCleanupStatus === 'PENDING') return 'Access cleanup pending';
  return 'No offboarding cleanup started';
}

export default function EmployeeAdministrationPage() {
  const [employees, setEmployees] = useState<readonly Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [state, setState] = useState<PageState>('loading');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await apiData<EmployeePage>(await fetch(`${API_BASE_URL}/employees?page=1&pageSize=100`, { credentials: 'include', cache: 'no-store' }));
      setEmployees(result.items);
      setSelected((current) => result.items.find((employee) => employee.id === current?.id) ?? result.items[0] ?? null);
      setState('ready');
      setMessage('');
    } catch (error) {
      const failure = requestError(error);
      setState(stateFor(failure.status));
      setMessage(failure.requestId ? `${failure.message} · Request ${failure.requestId}` : failure.message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function command(event: FormEvent<HTMLFormElement>, action: 'suspend' | 'offboard') {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) {
      setState('validation');
      setMessage('A reason is required.');
      return;
    }
    const impact = action === 'suspend'
      ? 'This immediately disables authentication and revokes Dar Tech sessions.'
      : 'This immediately disables authentication and starts removal of sessions, roles, temporary access, and emergency access.';
    if (!window.confirm(`${impact} Historical records will be preserved. Continue?`)) return;
    setSubmitting(true);
    try {
      const approvalReference = String(form.get('approvalReference') ?? '').trim();
      const result = await apiData<CommandResult>(await fetch(`${API_BASE_URL}/employees/${selected.id}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, ...(approvalReference ? { approvalReference } : {}) }),
      }));
      setEmployees((current) => current.map((employee) => employee.id === result.employee.id ? result.employee : employee));
      setSelected(result.employee);
      setState('ready');
      setMessage(result.outcome === 'approval_required'
        ? `Approval pending. Reference ${result.approvalReference ?? 'unavailable'}. Approval does not offboard automatically; replay this exact command after approval.`
        : result.outcome === 'cleanup_incomplete'
          ? 'Access remains blocked. Cleanup is incomplete and the same offboard command can be retried safely.'
          : `${action === 'suspend' ? 'Suspension' : 'Offboarding'} command completed. Historical records remain preserved.`);
    } catch (error) {
      const failure = requestError(error);
      setState(stateFor(failure.status));
      setMessage(failure.requestId ? `${failure.message} · Request ${failure.requestId}` : failure.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function archive() {
    if (!selected || !window.confirm('Archive this completed offboarding record? Access and historical records remain preserved.')) return;
    setSubmitting(true);
    try {
      const result = await apiData<CommandResult>(await fetch(`${API_BASE_URL}/employees/${selected.id}/archive`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }));
      setEmployees((current) => current.map((employee) => employee.id === result.employee.id ? result.employee : employee));
      setSelected(result.employee);
      setState('ready');
      setMessage('Employee archived. Account, SSO identity, approvals, grants, sessions, and audit history were preserved.');
    } catch (error) {
      const failure = requestError(error);
      setState(stateFor(failure.status));
      setMessage(failure.requestId ? `${failure.message} · Request ${failure.requestId}` : failure.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'unauthorized' || state === 'forbidden') return (
    <main className="workspace-main"><section className="state-card" role="alert"><span className="status-mark">Access controlled</span><h1>{state === 'unauthorized' ? 'Trusted authentication is required' : 'You do not have employee lifecycle authority'}</h1><p>{message}</p><button className="button secondary" onClick={() => void load()}>Retry</button></section></main>
  );

  return (
    <main className="workspace-main">
      <header className="workspace-header"><div><p className="eyebrow">Identity administration</p><h1>Employee access lifecycle</h1><p className="lede">Suspend, approved-offboard, and archive employee access without deleting identity or history.</p><p className="security-note compact"><strong>Access removal is immediate.</strong> The server—not these controls—enforces current permission, policy, approval, lifecycle, account, session, and organization boundaries.</p></div><div className="header-links"><a className="text-link" href="/admin/approvals">Approval inbox</a><a className="text-link" href="/">Portal home</a></div></header>
      {message ? <p className={['conflict', 'validation', 'error'].includes(state) ? 'error-banner' : 'security-note'} role="status">{message}</p> : null}
      <div className="workspace-grid">
        <section className="panel list-panel" aria-busy={state === 'loading'}><div className="panel-heading row-heading"><div><p className="eyebrow">Organization scope</p><h2>Employees</h2></div><button className="text-link button-link" onClick={() => void load()}>Refresh</button></div>{state === 'loading' ? <p className="muted">Loading employees…</p> : null}{state === 'ready' && employees.length === 0 ? <p className="empty-state">No employees found.</p> : null}<div className="invitation-list">{employees.map((employee) => <button className="invitation-row button-link" key={employee.id} onClick={() => setSelected(employee)}><span><strong>{employee.displayName}</strong><span>{employee.employeeCode} · {employee.workEmail}</span></span><span className={`pill ${employee.lifecycleStatus.toLowerCase()}`}>{employee.lifecycleStatus}</span></button>)}</div></section>
        <section className="panel"><div className="panel-heading"><p className="eyebrow">Exact employee target</p><h2>Lifecycle command</h2></div>{!selected ? <p className="empty-state">Choose an employee.</p> : <><h3>{selected.displayName}</h3><p><span className={`pill ${selected.lifecycleStatus.toLowerCase()}`}>{selected.lifecycleStatus}</span> · Account {selected.userAccount?.authenticationEligible ? 'authentication eligible' : 'authentication disabled'}</p><p>{cleanupText(selected)}</p><p className="muted">Cleanup totals: sessions {selected.offboardingSessionsRevokedCount ?? 0}, roles {selected.offboardingRolesEndedCount ?? 0}, temporary {selected.offboardingTemporaryAccessEndedCount ?? 0}, emergency {selected.offboardingEmergencyAccessEndedCount ?? 0}.</p>{selected.offboardingApprovalReference ? <p>Approval reference: <code>{selected.offboardingApprovalReference}</code></p> : null}{selected.offboardingReason ? <p>Preserved reason: {selected.offboardingReason}</p> : null}
          {selected.lifecycleStatus === 'ACTIVE' ? <form className="form-grid" onSubmit={(event) => void command(event, 'suspend')}><label>Mandatory suspension reason<textarea name="reason" required maxLength={500} rows={3} /></label><label>Approval reference, if policy requires<input name="approvalReference" /></label><button className="button secondary" disabled={submitting}>Suspend access</button></form> : null}
          {['ACTIVE', 'SUSPENDED', 'OFFBOARDING'].includes(selected.lifecycleStatus) ? <form className="form-grid" onSubmit={(event) => void command(event, 'offboard')}><label>Mandatory offboarding reason<textarea name="reason" required maxLength={500} rows={3} defaultValue={selected.offboardingReason ?? ''} /></label><label>Approved reference<input name="approvalReference" defaultValue={selected.offboardingApprovalReference ?? ''} /></label><button className="button primary" disabled={submitting}>{selected.lifecycleStatus === 'OFFBOARDING' ? 'Retry access cleanup' : 'Request or execute offboarding'}</button></form> : null}
          {selected.lifecycleStatus === 'OFFBOARDING' && selected.offboardingCleanupStatus === 'COMPLETED' ? <button className="button primary" disabled={submitting} onClick={() => void archive()}>Archive completed offboarding</button> : null}
          <p className="security-note compact">No delete, resume, reactivate, unsuspend, unarchive, or bulk lifecycle action exists. Account, SSO identity, approval, role, grant, session, audit, and security history remain queryable.</p></>}</section>
      </div>
    </main>
  );
}
