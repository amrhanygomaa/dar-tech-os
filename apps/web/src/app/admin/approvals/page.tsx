"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, apiData, requestError } from "../../../lib/api";

interface ApprovalStep {
  readonly id: string;
  readonly sequence: number;
  readonly status: string;
  readonly version: number;
  readonly actionable: boolean;
  readonly canApprove: boolean;
  readonly canReject: boolean;
  readonly safeDecisionReason: string | null;
}
interface ApprovalHistory {
  readonly id: string;
  readonly category: string;
  readonly requestStatus: string;
  readonly executionState: string;
  readonly safeReason: string | null;
  readonly occurredAt: string;
}
interface Approval {
  readonly id: string;
  readonly requesterSnapshot: Record<string, unknown>;
  readonly actionKey: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly resourceSnapshot: Record<string, unknown> | null;
  readonly risk: string;
  readonly status: string;
  readonly safeRequestReason: string | null;
  readonly executionState: string;
  readonly steps: readonly ApprovalStep[];
  readonly history: readonly ApprovalHistory[];
  readonly createdAt: string;
}
interface ApprovalPage {
  readonly items: readonly Approval[];
  readonly total: number;
}

export default function ApprovalInboxPage() {
  const [items, setItems] = useState<readonly Approval[]>([]);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await apiData<ApprovalPage>(
        await fetch(
          `${API_BASE_URL}/approvals?page=${pageNumber}&pageSize=25${status ? `&status=${status}` : ""}${risk ? `&risk=${risk}` : ""}`,
          { credentials: "include", cache: "no-store" },
        ),
      );
      setItems(page.items);
      setTotal(page.total);
      setSelected((current) =>
        current
          ? (page.items.find((item) => item.id === current.id) ?? null)
          : null,
      );
      setMessage("");
    } catch (error) {
      setItems([]);
      setSelected(null);
      setTotal(0);
      setMessage(requestError(error).message);
    } finally {
      setLoading(false);
    }
  }, [pageNumber, status, risk]);

  useEffect(() => {
    void load();
  }, [load]);

  async function select(id: string) {
    try {
      setSelected(
        await apiData<Approval>(
          await fetch(`${API_BASE_URL}/approvals/${id}`, {
            credentials: "include",
            cache: "no-store",
          }),
        ),
      );
    } catch (error) {
      setMessage(requestError(error).message);
    }
  }

  async function decide(step: ApprovalStep, decision: "approve" | "reject") {
    if (
      !selected ||
      busy ||
      !step.actionable ||
      !(decision === "approve" ? step.canApprove : step.canReject)
    )
      return;
    setBusy(true);
    try {
      const updated = await apiData<Approval>(
        await fetch(`${API_BASE_URL}/approvals/${selected.id}/${decision}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stepId: step.id,
            expectedVersion: step.version,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }),
        }),
      );
      setSelected(updated);
      setReason("");
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setMessage(`Decision recorded: ${decision}.`);
    } catch (error) {
      const failure = requestError(error);
      setSelected(null);
      setMessage(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace-main">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Controlled decisions</p>
          <h1>Approval inbox</h1>
          <p className="lede">
            Review organization-scoped requests. Permission alone does not make
            an employee an eligible approver.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </button>
      </header>
      {message ? (
        <p className="error-banner" role="status">
          {message}
        </p>
      ) : null}
      <div className="row-actions">
        <label>
          Status{" "}
          <select
            value={status}
            disabled={busy}
            onChange={(event) => {
              setStatus(event.target.value);
              setPageNumber(1);
            }}
          >
            <option value="">All statuses</option>
            {[
              "PENDING",
              "IN_REVIEW",
              "APPROVED",
              "REJECTED",
              "EXECUTED",
              "FAILED",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Risk{" "}
          <select
            value={risk}
            disabled={busy}
            onChange={(event) => {
              setRisk(event.target.value);
              setPageNumber(1);
            }}
          >
            <option value="">All risks</option>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="workspace-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Requests</h2>
            <p className="muted">
              {loading ? "Loading…" : `${total} authorized request(s)`}
            </p>
          </div>
          <div className="invitation-list">
            {items.map((item) => (
              <button
                className="approval-row"
                key={item.id}
                onClick={() => void select(item.id)}
              >
                <span>
                  <strong>{item.actionKey}</strong>
                  <small>
                    {item.resourceType} · {item.risk}
                  </small>
                </span>
                <span className={`pill ${item.status.toLowerCase()}`}>
                  {item.status}
                </span>
              </button>
            ))}
            {!loading && items.length === 0 ? (
              <p className="empty-state">
                No authorized approval requests are visible.
              </p>
            ) : null}
          </div>
          <div className="row-actions">
            <button
              className="button secondary"
              disabled={busy || loading || pageNumber === 1}
              onClick={() => setPageNumber(pageNumber - 1)}
            >
              Previous
            </button>
            <span>Page {pageNumber}</span>
            <button
              className="button secondary"
              disabled={busy || loading || pageNumber * 25 >= total}
              onClick={() => setPageNumber(pageNumber + 1)}
            >
              Next
            </button>
          </div>
        </section>
        <section className="panel">
          {selected ? (
            <>
              <div className="panel-heading">
                <p className="eyebrow">{selected.risk} risk</p>
                <h2>{selected.actionKey}</h2>
                <p className="muted">
                  Requested {new Date(selected.createdAt).toLocaleString()} ·{" "}
                  {selected.status} · execution {selected.executionState}
                </p>
              </div>
              <p>
                Requester:{" "}
                {typeof selected.requesterSnapshot.displayName === "string"
                  ? selected.requesterSnapshot.displayName
                  : "Employee"}
              </p>
              <p>
                Target:{" "}
                {typeof selected.resourceSnapshot?.displayName === "string"
                  ? selected.resourceSnapshot.displayName
                  : selected.resourceType}{" "}
                · {selected.resourceType}
                {selected.resourceId
                  ? ` / ${selected.resourceId}`
                  : " (collection)"}
              </p>
              <p>
                {selected.safeRequestReason ?? "No request reason supplied."}
              </p>
              <h2>Steps</h2>
              <p className="muted">
                All steps in a sequence must approve before the next sequence
                becomes eligible.
              </p>
              <label>
                Decision reason (optional)
                <input
                  maxLength={500}
                  value={reason}
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="invitation-list">
                {selected.steps.map((step) => (
                  <div className="invitation-row" key={step.id}>
                    <span>
                      <strong>Sequence {step.sequence}</strong>
                      <small className="muted">{step.status}</small>
                    </span>
                    {step.actionable ? (
                      <span className="row-actions">
                        {step.canApprove ? (
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() => void decide(step, "approve")}
                          >
                            Approve
                          </button>
                        ) : null}
                        {step.canReject ? (
                          <button
                            className="button secondary danger"
                            disabled={busy}
                            onClick={() => void decide(step, "reject")}
                          >
                            Reject
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
              <h2>History</h2>
              <div className="invitation-list">
                {selected.history.map((entry) => (
                  <div className="invitation-row" key={entry.id}>
                    <span>
                      <strong>{entry.category}</strong>
                      <small className="muted">
                        {new Date(entry.occurredAt).toLocaleString()}
                      </small>
                    </span>
                    <span className="pill">{entry.requestStatus}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="empty-state">
              Select a request to review its exact target, ordered steps,
              status, execution state, and append-only history.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
