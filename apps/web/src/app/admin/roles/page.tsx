'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, apiData, requestError } from '../../../lib/api';

interface Role {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly archived: boolean;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RolePage {
  readonly items: readonly Role[];
  readonly total: number;
}

interface EmployeeRole {
  readonly id: string;
  readonly employeeId: string;
  readonly roleId: string;
  readonly role: Role;
  readonly assignedAt: string;
  readonly effectiveAt: string;
  readonly expiresAt: string | null;
  readonly removedAt: string | null;
  readonly effective: boolean;
}

type PageState =
  | 'loading'
  | 'ready'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'validation'
  | 'error';

function stateFor(status: number): PageState {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  return 'error';
}

export default function RoleAdministrationPage() {
  const [roles, setRoles] = useState<readonly Role[]>([]);
  const [assignments, setAssignments] = useState<readonly EmployeeRole[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);
  const [state, setState] = useState<PageState>('loading');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await apiData<RolePage>(
        await fetch(`${API_BASE_URL}/roles?page=1&pageSize=100`, {
          credentials: 'include',
          cache: 'no-store',
        }),
      );
      setRoles(result.items);
      setState('ready');
      setMessage('');
    } catch (error) {
      const failure = requestError(error);
      setMessage(failure.requestId ? `${failure.message} · Request ${failure.requestId}` : failure.message);
      setState(stateFor(failure.status));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function reportFailure(error: unknown) {
    const failure = requestError(error);
    setMessage(failure.requestId ? `${failure.message} · Request ${failure.requestId}` : failure.message);
    setState(stateFor(failure.status));
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const role = await apiData<Role>(
        await fetch(`${API_BASE_URL}/roles`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: form.get('key'),
            name: form.get('name'),
            description: form.get('description'),
          }),
        }),
      );
      setRoles((current) => [...current, role]);
      event.currentTarget.reset();
      setState('ready');
      setMessage('Role created. Permission grants are managed separately and do not authorize actions until T07.');
    } catch (error) {
      reportFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function updateRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const role = await apiData<Role>(
        await fetch(`${API_BASE_URL}/roles/${editing.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.get('name'),
            description: form.get('description'),
          }),
        }),
      );
      setRoles((current) => current.map((item) => (item.id === role.id ? role : item)));
      setEditing(null);
      setState('ready');
      setMessage('Role presentation fields updated. The stable key did not change.');
    } catch (error) {
      reportFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function archiveRole(id: string) {
    setSubmitting(true);
    try {
      const role = await apiData<Role>(
        await fetch(`${API_BASE_URL}/roles/${id}/archive`, {
          method: 'POST',
          credentials: 'include',
        }),
      );
      setRoles((current) => current.map((item) => (item.id === role.id ? role : item)));
      setAssignments((current) =>
        current.map((assignment) =>
          assignment.roleId === role.id
            ? { ...assignment, role, effective: false }
            : assignment,
        ),
      );
      setState('ready');
      setMessage('Role archived. Historical assignments remain preserved.');
    } catch (error) {
      reportFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function assignRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const employeeId = String(form.get('employeeId') ?? '');
    const expiry = String(form.get('expiresAt') ?? '');
    try {
      const assignment = await apiData<EmployeeRole>(
        await fetch(`${API_BASE_URL}/employees/${employeeId}/roles`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roleId: form.get('roleId'),
            ...(expiry ? { expiresAt: new Date(expiry).toISOString() } : {}),
          }),
        }),
      );
      setAssignments((current) => [
        assignment,
        ...current.filter((item) => item.id !== assignment.id),
      ]);
      setState('ready');
      setMessage('Role assignment recorded. Multiple simultaneous roles are preserved.');
    } catch (error) {
      reportFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeRole(assignment: EmployeeRole) {
    setSubmitting(true);
    try {
      const removed = await apiData<EmployeeRole>(
        await fetch(
          `${API_BASE_URL}/employees/${assignment.employeeId}/roles/${assignment.roleId}/remove`,
          { method: 'POST', credentials: 'include' },
        ),
      );
      setAssignments((current) =>
        current.map((item) => (item.id === removed.id ? removed : item)),
      );
      setState('ready');
      setMessage('Assignment removed historically; no assignment row was deleted.');
    } catch (error) {
      reportFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'unauthorized' || state === 'forbidden') {
    return (
      <main className="workspace-main">
        <section className="state-card" role="alert">
          <span className="status-mark">Access controlled</span>
          <h1>{state === 'unauthorized' ? 'Trusted authentication is required' : 'You do not have this permission'}</h1>
          <p>{message}</p>
          <button className="button secondary" onClick={() => void load()}>Retry</button>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-main">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Identity administration</p>
          <h1>Roles and assignments</h1>
          <p className="lede">Create organization roles and preserve multi-role assignment history.</p>
          <p className="security-note compact"><strong>Role names never authorize actions.</strong> T06 stores explicit grants; final application authorization remains deferred to T07.</p>
        </div>
        <div className="header-links"><a className="text-link" href="/admin/permissions">Permission administration</a><a className="text-link" href="/">Portal home</a></div>
      </header>

      <div className="workspace-grid role-workspace">
        <section className="panel" aria-labelledby="create-role-title">
          <div className="panel-heading">
            <p className="eyebrow">Stable definition</p>
            <h2 id="create-role-title">Create role</h2>
          </div>
          <form className="form-grid" onSubmit={(event) => void createRole(event)}>
            <label>Stable key<input name="key" required maxLength={64} placeholder="project-manager" /></label>
            <label>Display name<input name="name" required maxLength={160} /></label>
            <label>Description<textarea name="description" maxLength={500} rows={3} /></label>
            <button className="button primary" disabled={submitting}>{submitting ? 'Working…' : 'Create role'}</button>
          </form>
        </section>

        <section className="panel list-panel" aria-labelledby="role-list-title" aria-busy={state === 'loading'}>
          <div className="panel-heading row-heading">
            <div><p className="eyebrow">Organization scope</p><h2 id="role-list-title">Roles</h2></div>
            <button className="text-link button-link" onClick={() => void load()}>Refresh</button>
          </div>
          {state === 'loading' ? <p className="muted" role="status">Loading roles…</p> : null}
          {['error', 'conflict', 'validation'].includes(state) ? <p className="error-banner" role="alert">{message}</p> : null}
          {state === 'ready' && roles.length === 0 ? <p className="empty-state">No roles have been created.</p> : null}
          <div className="invitation-list">
            {roles.map((role) => (
              <article className="invitation-row" key={role.id}>
                <div><strong>{role.name}</strong><p><code>{role.key}</code> · {role.description ?? 'No description'}</p></div>
                <div className="row-actions">
                  <span className={`pill ${role.archived ? 'archived' : 'active'}`}>{role.archived ? 'ARCHIVED' : 'ACTIVE'}</span>
                  <button className="text-link button-link" onClick={() => setEditing(role)}>Edit</button>
                  {!role.archived ? <button className="text-link danger button-link" disabled={submitting} onClick={() => void archiveRole(role.id)}>Archive</button> : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="edit-role-title">
          <div className="panel-heading"><p className="eyebrow">Immutable key</p><h2 id="edit-role-title">Role detail and edit</h2></div>
          {editing ? (
            <form className="form-grid" key={editing.id} onSubmit={(event) => void updateRole(event)}>
              <label>Stable key<input value={editing.key} readOnly aria-readonly="true" /></label>
              <label>Display name<input name="name" required maxLength={160} defaultValue={editing.name} /></label>
              <label>Description<textarea name="description" maxLength={500} rows={3} defaultValue={editing.description ?? ''} /></label>
              <div className="row-actions"><button className="button primary" disabled={submitting}>Save</button><button type="button" className="button secondary" onClick={() => setEditing(null)}>Cancel</button></div>
            </form>
          ) : <p className="empty-state">Choose a role to edit its presentation fields.</p>}
        </section>

        <section className="panel" aria-labelledby="assign-role-title">
          <div className="panel-heading"><p className="eyebrow">Historical multi-role model</p><h2 id="assign-role-title">Assign role</h2></div>
          <form className="form-grid" onSubmit={(event) => void assignRole(event)}>
            <label>Employee ID<input name="employeeId" required aria-describedby="employee-id-help" /></label>
            <small id="employee-id-help" className="muted">Use an employee UUID from the employee administration view.</small>
            <label>Role<select name="roleId" required defaultValue=""><option value="" disabled>Select an active role</option>{roles.filter((role) => !role.archived).map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
            <label>Optional expiry<input name="expiresAt" type="datetime-local" /></label>
            <button className="button primary" disabled={submitting || roles.every((role) => role.archived)}>Assign another role</button>
          </form>
          <div className="assignment-history" aria-live="polite">
            <h2>Assigned role results</h2>
            {assignments.length === 0 ? <p className="empty-state">No assignment command has completed in this view.</p> : null}
            {assignments.map((assignment) => (
              <article className="assignment-row" key={assignment.id}>
                <div><strong>{assignment.role.name}</strong><p>Employee {assignment.employeeId}</p><p>Effective {new Date(assignment.effectiveAt).toLocaleString()} · Expires {assignment.expiresAt ? new Date(assignment.expiresAt).toLocaleString() : 'never'}</p><p>Removed {assignment.removedAt ? new Date(assignment.removedAt).toLocaleString() : 'no'}</p></div>
                <div className="row-actions"><span className={`pill ${assignment.effective ? 'active' : 'archived'}`}>{assignment.effective ? 'EFFECTIVE' : 'INACTIVE'}</span>{assignment.effective ? <button className="text-link danger button-link" disabled={submitting} onClick={() => void removeRole(assignment)}>Remove</button> : null}</div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
