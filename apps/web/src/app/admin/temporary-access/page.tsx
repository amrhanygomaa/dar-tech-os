"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { API_BASE_URL, apiData, requestError } from "../../../lib/api";

interface Binding {
  readonly id: string;
  readonly permissionKey: string;
  readonly scopeType: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
}
interface Grant {
  readonly id: string;
  readonly issuerSnapshot: Record<string, string>;
  readonly recipientSnapshot: Record<string, string>;
  readonly recipientEmployeeId: string;
  readonly reason: string;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly status: string;
  readonly storedStatus: string;
  readonly approvalReference: string | null;
  readonly revokedAt: string | null;
  readonly canRevoke: boolean;
  readonly bindings: readonly Binding[];
}
interface Page { readonly items: readonly Grant[]; readonly total: number }

export default function TemporaryAccessPage() {
  const [items, setItems] = useState<readonly Grant[]>([]);
  const [selected, setSelected] = useState<Grant | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [reason, setReason] = useState("");
  const [permissionKey, setPermissionKey] = useState("admin.employee.read");
  const [scopeType, setScopeType] = useState("ORGANIZATION");
  const [resourceType, setResourceType] = useState("employee");
  const [resourceId, setResourceId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (status) query.set("status", status);
      const result = await apiData<Page>(await fetch(`${API_BASE_URL}/temporary-access?${query}`, { credentials: "include", cache: "no-store" }));
      setItems(result.items); setTotal(result.total);
      setSelected((current) => current ? result.items.find((item) => item.id === current.id) ?? null : null);
      setMessage("");
    } catch (error) { setItems([]); setSelected(null); setTotal(0); setMessage(requestError(error).message); }
    finally { setLoading(false); }
  }, [page, status]);
  useEffect(() => { void load(); }, [load]);

  async function detail(id: string) {
    try { setSelected(await apiData<Grant>(await fetch(`${API_BASE_URL}/temporary-access/${id}`, { credentials: "include", cache: "no-store" }))); }
    catch (error) { setMessage(requestError(error).message); }
  }

  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true);
    try {
      const grant = await apiData<Grant>(await fetch(`${API_BASE_URL}/employees/${recipientId}/temporary-access`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ reason, startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), bindings: [{ permissionKey, scopeType, resourceType, ...(scopeType === "ORGANIZATION" ? {} : { resourceId }) }] }),
      }));
      setSelected(grant); setMessage(grant.status === "PENDING_APPROVAL" ? "Approval request created; grant remains inactive." : "Temporary access grant recorded.");
      await load();
    } catch (error) { setMessage(requestError(error).message); }
    finally { setBusy(false); }
  }

  async function revoke() {
    if (!selected || !selected.canRevoke || busy) return;
    setBusy(true);
    try {
      const result = await apiData<{ grant: Grant }>(await fetch(`${API_BASE_URL}/temporary-access/${selected.id}/revoke`, { method: "POST", credentials: "include" }));
      setSelected(result.grant); setMessage("Temporary access has been revoked."); await load();
    } catch (error) { setMessage(requestError(error).message); }
    finally { setBusy(false); }
  }

  return <main className="workspace-main">
    <header className="workspace-header"><div><p className="eyebrow">Controlled access</p><h1>Temporary access</h1><p className="lede">Explicit, time-bounded delegation. Expiry and revocation remove authority immediately.</p></div><button className="button secondary" onClick={() => void load()} disabled={loading}>Refresh</button></header>
    {message ? <p className="error-banner" role="status">{message}</p> : null}
    <div className="workspace-grid"><section className="panel"><div className="panel-heading"><h2>Create grant</h2><p className="muted">The issuer is always the current signed-in employee.</p></div>
      <form onSubmit={(event) => void create(event)} className="invitation-list">
        <label>Recipient employee ID<input required value={recipientId} onChange={(event) => setRecipientId(event.target.value)} /></label>
        <label>Reason<input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <label>Permission key<input required value={permissionKey} onChange={(event) => setPermissionKey(event.target.value)} /></label>
        <label>Scope<select value={scopeType} onChange={(event) => setScopeType(event.target.value)}>{["ORGANIZATION", "EXPLICIT", "ASSIGNED", "TEAM", "DEPARTMENT", "PROJECT", "CUSTOMER"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Resource type<input required value={resourceType} onChange={(event) => setResourceType(event.target.value)} /></label>
        {scopeType !== "ORGANIZATION" ? <label>Exact resource ID<input required value={resourceId} onChange={(event) => setResourceId(event.target.value)} /></label> : null}
        <label>Start<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
        <label>Expiry<input required type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        <button className="button primary" disabled={busy}>Create request</button>
      </form></section>
      <section className="panel"><div className="panel-heading"><h2>Grant history</h2><p className="muted">{loading ? "Loading…" : `${total} authorized grant(s)`}</p></div>
        <label>Status <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{["PENDING_APPROVAL", "SCHEDULED", "ACTIVE", "REVOKED", "EXPIRED"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <div className="invitation-list">{items.map((grant) => <button className="approval-row" key={grant.id} onClick={() => void detail(grant.id)}><span><strong>{grant.recipientSnapshot.displayName ?? "Employee"}</strong><small>{grant.status} · expires {new Date(grant.expiresAt).toLocaleString()}</small></span><span className={`pill ${grant.status.toLowerCase()}`}>{grant.status}</span></button>)}{!loading && !items.length ? <p className="empty-state">No authorized grants are visible.</p> : null}</div>
        <div className="row-actions"><button className="button secondary" disabled={busy || loading || page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="button secondary" disabled={busy || loading || page * 25 >= total} onClick={() => setPage(page + 1)}>Next</button></div>
      </section></div>
    <section className="panel">{selected ? <><div className="panel-heading"><p className="eyebrow">{selected.status}</p><h2>Grant detail</h2><p className="muted">Issuer {selected.issuerSnapshot.displayName ?? "Employee"} · recipient {selected.recipientSnapshot.displayName ?? "Employee"}</p></div><p>{selected.reason}</p><p>Starts {new Date(selected.startsAt).toLocaleString()} · expires {new Date(selected.expiresAt).toLocaleString()}</p><p>{selected.approvalReference ? `Approval reference: ${selected.approvalReference}` : "No approval reference required by the active policy."}</p><h2>Exact bindings</h2><div className="invitation-list">{selected.bindings.map((binding) => <div className="invitation-row" key={binding.id}><span><strong>{binding.permissionKey}</strong><small className="muted">{binding.scopeType} · {binding.resourceType}{binding.resourceId ? ` / ${binding.resourceId}` : ""}</small></span></div>)}</div>{selected.canRevoke ? <button className="button secondary danger" disabled={busy} onClick={() => void revoke()}>Revoke immediately</button> : <p className="muted">This grant is not currently eligible for revocation.</p>}</> : <p className="empty-state">Select a grant to inspect its exact bindings, approval reference, and terminal history.</p>}</section>
  </main>;
}
