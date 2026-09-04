"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { API_BASE_URL, apiData, requestError } from "../../../lib/api";

interface Permission {
  readonly id: string;
  readonly key: string;
  readonly domain: string;
  readonly resource: string;
  readonly action: string;
  readonly description: string;
  readonly riskClassification: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly active: boolean;
  readonly deprecatedAt: string | null;
  readonly definitionVersion: number;
}

interface PermissionPage {
  readonly items: readonly Permission[];
  readonly total: number;
}

interface RolePermission {
  readonly id: string;
  readonly roleId: string;
  readonly permission: Permission;
  readonly scopeType: string;
  readonly scopeBindingType: string | null;
  readonly scopeBindingId: string | null;
  readonly grantedAt: string;
  readonly effectiveAt: string;
  readonly expiresAt: string | null;
  readonly removedAt: string | null;
  readonly effective: boolean;
}

interface RolePermissionPage {
  readonly items: readonly RolePermission[];
  readonly total: number;
}

type PageState =
  | "loading"
  | "ready"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "validation"
  | "error";

const scopeTypes = [
  "SELF",
  "ASSIGNED",
  "TEAM",
  "DEPARTMENT",
  "PROJECT",
  "CUSTOMER",
  "ORGANIZATION",
  "EXPLICIT",
] as const;

const relationshipScopeTypes = [
  "ASSIGNED",
  "TEAM",
  "DEPARTMENT",
  "PROJECT",
  "CUSTOMER",
] as const;

function isRelationshipScope(
  scope: (typeof scopeTypes)[number],
): scope is (typeof relationshipScopeTypes)[number] {
  return (relationshipScopeTypes as readonly string[]).includes(scope);
}

const scopeLabels: Record<(typeof scopeTypes)[number], string> = {
  SELF: "SELF — approved account/session ownership only",
  ORGANIZATION: "ORGANIZATION — same organization",
  EXPLICIT: "EXPLICIT — exact resource type and ID",
  ASSIGNED: "ASSIGNED — owning resolver required",
  TEAM: "TEAM — owning resolver required",
  DEPARTMENT: "DEPARTMENT — owning resolver required",
  PROJECT: "PROJECT — owning resolver required",
  CUSTOMER: "CUSTOMER — owning resolver required",
};

function stateFor(status: number): PageState {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  return "error";
}

export default function PermissionAdministrationPage() {
  const [permissions, setPermissions] = useState<readonly Permission[]>([]);
  const [history, setHistory] = useState<readonly RolePermission[]>([]);
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] =
    useState<(typeof scopeTypes)[number]>("ORGANIZATION");
  const [state, setState] = useState<PageState>("loading");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const grouped = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const permission of permissions) {
      const key = `${permission.domain}.${permission.resource}`;
      groups.set(key, [...(groups.get(key) ?? []), permission]);
    }
    return [...groups.entries()];
  }, [permissions]);

  const reportFailure = useCallback((error: unknown) => {
    const failure = requestError(error);
    setMessage(
      failure.requestId
        ? `${failure.message} · Request ${failure.requestId}`
        : failure.message,
    );
    setState(stateFor(failure.status));
  }, []);

  const loadCatalog = useCallback(async () => {
    setState("loading");
    try {
      const result = await apiData<PermissionPage>(
        await fetch(`${API_BASE_URL}/permissions?page=1&pageSize=100`, {
          credentials: "include",
          cache: "no-store",
        }),
      );
      setPermissions(result.items);
      setState("ready");
      setMessage("");
    } catch (error) {
      reportFailure(error);
    }
  }, [reportFailure]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  async function loadHistory(selectedRoleId = roleId) {
    if (!selectedRoleId) {
      setState("validation");
      setMessage("Enter a role UUID to load persisted permission history.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiData<RolePermissionPage>(
        await fetch(
          `${API_BASE_URL}/roles/${selectedRoleId}/permissions?page=1&pageSize=100`,
          {
            credentials: "include",
            cache: "no-store",
          },
        ),
      );
      setHistory(result.items);
      setState("ready");
      setMessage(
        result.total === 0
          ? "This role has no permission grant history."
          : "Persisted grant history loaded.",
      );
    } catch (error) {
      reportFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function grantPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedRoleId = String(form.get("roleId") ?? "");
    const bindingType = String(form.get("scopeBindingType") ?? "");
    const bindingId = String(form.get("scopeBindingId") ?? "");
    const expiry = String(form.get("expiresAt") ?? "");
    setSubmitting(true);
    try {
      await apiData<RolePermission>(
        await fetch(`${API_BASE_URL}/roles/${selectedRoleId}/permissions`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permissionKey: form.get("permissionKey"),
            scopeType,
            ...(bindingType ? { scopeBindingType: bindingType } : {}),
            ...(bindingId ? { scopeBindingId: bindingId } : {}),
            ...(expiry ? { expiresAt: new Date(expiry).toISOString() } : {}),
          }),
        }),
      );
      setRoleId(selectedRoleId);
      await loadHistory(selectedRoleId);
      setMessage(
        "Permission grant recorded. Current effective grants are used by server-side authorization on the next decision.",
      );
    } catch (error) {
      reportFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function removePermission(grant: RolePermission) {
    setSubmitting(true);
    try {
      await apiData<RolePermission>(
        await fetch(
          `${API_BASE_URL}/roles/${grant.roleId}/permissions/${encodeURIComponent(grant.permission.key)}/remove`,
          { method: "POST", credentials: "include" },
        ),
      );
      await loadHistory(grant.roleId);
      setMessage(
        "Grant removed historically; the RolePermission row remains preserved.",
      );
    } catch (error) {
      reportFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "unauthorized" || state === "forbidden") {
    return (
      <main className="workspace-main">
        <section className="state-card" role="alert">
          <span className="status-mark">Access controlled</span>
          <h1>
            {state === "unauthorized"
              ? "Trusted authentication is required"
              : "You do not have this permission"}
          </h1>
          <p>{message}</p>
          <button
            className="button secondary"
            onClick={() => void loadCatalog()}
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  const bindingDisabled = scopeType === "SELF" || scopeType === "ORGANIZATION";
  const bindingRequired = scopeType === "EXPLICIT";
  const relationshipScope = isRelationshipScope(scopeType);

  return (
    <main className="workspace-main">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Security contracts</p>
          <h1>Permissions and role grants</h1>
          <p className="lede">
            Review the global registry and administer organization-owned
            historical grants.
          </p>
          <p className="security-note compact">
            <strong>Application actions are authorized server-side.</strong> Risk is
            technical metadata, not an approval decision. Unsupported relationship
            scopes remain fail-closed until their resolver is implemented.
          </p>
        </div>
        <div className="header-links">
          <a className="text-link" href="/admin/roles">
            Role administration
          </a>
          <a className="text-link" href="/">
            Portal home
          </a>
        </div>
      </header>

      <div className="workspace-grid permission-workspace">
        <section
          className="panel list-panel"
          aria-labelledby="permission-catalog-title"
          aria-busy={state === "loading"}
        >
          <div className="panel-heading row-heading">
            <div>
              <p className="eyebrow">Code-owned registry</p>
              <h2 id="permission-catalog-title">Permission catalog</h2>
            </div>
            <button
              className="text-link button-link"
              onClick={() => void loadCatalog()}
            >
              Refresh
            </button>
          </div>
          {state === "loading" ? (
            <p className="muted" role="status">
              Loading permission catalog…
            </p>
          ) : null}
          {["error", "conflict", "validation"].includes(state) ? (
            <p className="error-banner" role="alert">
              {message}
            </p>
          ) : null}
          {state === "ready" && permissions.length === 0 ? (
            <p className="empty-state">
              No synchronized permissions are available.
            </p>
          ) : null}
          <div className="permission-groups">
            {grouped.map(([group, items]) => (
              <section
                className="permission-group"
                key={group}
                aria-labelledby={`group-${group}`}
              >
                <h3 id={`group-${group}`}>{group}</h3>
                {items.map((permission) => (
                  <article className="permission-row" key={permission.key}>
                    <div>
                      <code>{permission.key}</code>
                      <p>{permission.description}</p>
                    </div>
                    <div className="row-actions">
                      <span
                        className={`pill risk-${permission.riskClassification.toLowerCase()}`}
                      >
                        {permission.riskClassification}
                      </span>
                      <span
                        className={`pill ${permission.active && !permission.deprecatedAt ? "active" : "archived"}`}
                      >
                        {permission.active && !permission.deprecatedAt
                          ? "ACTIVE"
                          : "INACTIVE"}
                      </span>
                    </div>
                  </article>
                ))}
              </section>
            ))}
          </div>
        </section>

        <div className="permission-admin-column">
          <section className="panel" aria-labelledby="grant-permission-title">
            <div className="panel-heading">
              <p className="eyebrow">Organization-owned history</p>
              <h2 id="grant-permission-title">Grant role permission</h2>
            </div>
            <form
              className="form-grid"
              onSubmit={(event) => void grantPermission(event)}
            >
              <label>
                Role ID
                <input
                  name="roleId"
                  required
                  value={roleId}
                  onChange={(event) => setRoleId(event.target.value)}
                />
              </label>
              <label>
                Permission
                <select name="permissionKey" required defaultValue="">
                  <option value="" disabled>
                    Select a registered permission
                  </option>
                  {permissions
                    .filter(
                      (permission) =>
                        permission.active && !permission.deprecatedAt,
                    )
                    .map((permission) => (
                      <option value={permission.key} key={permission.key}>
                        {permission.key} · {permission.riskClassification}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Scope
                <select
                  name="scopeType"
                  value={scopeType}
                  onChange={(event) =>
                    setScopeType(
                      event.target.value as (typeof scopeTypes)[number],
                    )
                  }
                >
                  {scopeTypes.map((scope) => (
                    <option value={scope} key={scope}>
                      {scopeLabels[scope]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="security-note compact" role="status">
                {relationshipScope
                  ? `${scopeType} can be stored for future configuration, but it does not authorize in the current application because no owning relationship resolver is installed.`
                  : scopeType === "EXPLICIT"
                    ? "EXPLICIT requires an exact bounded resource type and resource ID. It never uses prefixes, wildcards, or hierarchy inference."
                    : scopeType === "SELF"
                      ? "SELF is limited to approved account and session ownership; it is not generic employee ownership."
                      : "ORGANIZATION applies only after the trusted actor and resource organizations match."}
              </p>
              <label>
                Binding type
                <input
                  name="scopeBindingType"
                  disabled={bindingDisabled}
                  required={bindingRequired}
                  placeholder="project"
                />
              </label>
              <label>
                Binding ID
                <input
                  name="scopeBindingId"
                  disabled={bindingDisabled}
                  required={bindingRequired}
                  placeholder="opaque-resource-id"
                />
              </label>
              <label>
                Optional expiry
                <input name="expiresAt" type="datetime-local" />
              </label>
              <div className="row-actions">
                <button
                  className="button primary"
                  disabled={submitting || permissions.length === 0}
                >
                  {submitting ? "Working…" : "Grant permission"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={submitting}
                  onClick={() => void loadHistory()}
                >
                  Load history
                </button>
              </div>
            </form>
          </section>

          <section className="panel" aria-labelledby="grant-history-title">
            <div className="panel-heading">
              <p className="eyebrow">Persisted and reloadable</p>
              <h2 id="grant-history-title">Role permission history</h2>
            </div>
            {history.length === 0 ? (
              <p className="empty-state">
                Enter a role ID and load its persisted history.
              </p>
            ) : null}
            <div className="assignment-history" aria-live="polite">
              {history.map((grant) => (
                <article className="assignment-row" key={grant.id}>
                  <div>
                    <strong>
                      <code>{grant.permission.key}</code>
                    </strong>
                    <p>
                      {grant.scopeType}
                      {grant.scopeBindingType
                        ? ` · ${grant.scopeBindingType}:${grant.scopeBindingId}`
                        : ""}
                      {isRelationshipScope(
                        grant.scopeType as (typeof scopeTypes)[number],
                      )
                        ? " · owning resolver required"
                        : ""}
                    </p>
                    <p>
                      Granted {new Date(grant.grantedAt).toLocaleString()} ·
                      Effective {new Date(grant.effectiveAt).toLocaleString()}
                    </p>
                    <p>
                      Expires{" "}
                      {grant.expiresAt
                        ? new Date(grant.expiresAt).toLocaleString()
                        : "never"}{" "}
                      · Removed{" "}
                      {grant.removedAt
                        ? new Date(grant.removedAt).toLocaleString()
                        : "no"}
                    </p>
                  </div>
                  <div className="row-actions">
                    <span
                      className={`pill risk-${grant.permission.riskClassification.toLowerCase()}`}
                    >
                      {grant.permission.riskClassification}
                    </span>
                    <span
                      className={`pill ${grant.effective ? "active" : "archived"}`}
                    >
                      {grant.effective ? "EFFECTIVE" : "INACTIVE"}
                    </span>
                    {grant.effective ? (
                      <button
                        className="text-link danger button-link"
                        disabled={submitting}
                        onClick={() => void removePermission(grant)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
