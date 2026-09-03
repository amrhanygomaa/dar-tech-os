# Sprint 02 T04 — Session Management

## Status and boundary

S02-T04 is authorized and implemented on `codex/sprint-02-t04-session-management`; it remains under pull-request review until the verification evidence is accepted and merged.

**T04 AUTHENTICATES SESSIONS.**

**T04 DOES NOT AUTHORIZE APPLICATION ACTIONS.**

The ticket adds the session identity foundation only. It does not implement the S02-T07 `authorize(actor, action, resource, context)` engine, role or permission evaluation, employee suspension/offboarding commands, bootstrap administration, password login, bearer tokens, refresh tokens, or JWT application sessions.

## Architecture

Browser authentication produces an opaque server-side session:

1. The API generates 32 cryptographically random bytes (256 bits) and encodes them as canonical base64url.
2. Only the SHA-256 digest is persisted in `Session.credentialHash`.
3. The raw credential exists only transiently in process memory, the `Set-Cookie` header, and the browser's HttpOnly cookie jar.
4. Every authenticated request hashes the cookie and resolves the digest against PostgreSQL.
5. Session identity, validity, employee/account eligibility, and organization-consistent relations are revalidated server-side.

The raw credential is never returned in JSON and is excluded from logs, metrics, audit events, security events, outbox payloads, OpenAPI examples, frontend state, and worker contracts. The session row contains no role, permission, Founder, job-title, or authorization snapshot.

## Cookie and CSRF policy

The browser cookie is named `dartech_session` and is serialized with:

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- no `Domain` attribute, making it host-only
- `Secure` in staging and production; local/test HTTP may omit `Secure`
- an expiry and maximum age bounded by absolute session expiry

Cookie-authenticated unsafe session mutations require an exact `Origin` match against `SESSION_ALLOWED_ORIGINS`. Missing and foreign origins are denied. `GET` and `HEAD` do not require mutation CSRF validation. Wildcards, URL paths, credentials, fragments, and non-origin values are rejected by startup configuration. The authentication redirect allowlist and the session CSRF origin allowlist remain separate controls.

## Persistence and validity

Migration `20260903180000_sprint_02_t04_session_management` adds the `session_client_kind` enum and the additive `sessions` table with restrictive organization, employee, account, and optional revoker relations. The account/employee composite relation prevents a session from combining mismatched ownership records.

A session is directly valid only when all of the following hold:

```text
revoked_at IS NULL
AND now < idle_expires_at
AND now < absolute_expires_at
AND Employee.lifecycleStatus = ACTIVE
AND UserAccount.authenticationEligible = true
AND UserAccount.disabledAt IS NULL
AND organization/account/employee ownership matches
```

Equality at either expiry boundary is invalid. Request denial never depends on a cleanup worker. `SUSPENDED`, `OFFBOARDING`, and `ARCHIVED` employee fixtures, disabled accounts, and authentication-ineligible accounts deny existing credentials immediately.

## Idle touch

A valid resolution takes the owner locks before the session-row lock, rechecks validity, and may move `lastSeenAt` forward. It sets idle expiry to the earlier of `now + SESSION_IDLE_TTL_SECONDS` and the absolute expiry. It cannot revive a revoked, idle-expired, absolute-expired, or ineligible session, and it cannot extend a session beyond its absolute lifetime.

## Authentication and onboarding issuance

S02-T03 linked-account callbacks retain their state, nonce, PKCE, redirect allowlist, provider verification, and replay controls. After verification, T04 rechecks the account and employee, creates a fresh random credential, commits the session plus audit/security/outbox history, and only then emits `Set-Cookie`. Success returns `sessionCreated: true` and `nextStep: SESSION_ESTABLISHED`; no credential is present in JSON. Persistence or mandatory-history failure returns a generic authentication failure and no cookie.

Authentication never adopts a caller-supplied cookie. An unknown incoming value is ignored as authority and a new credential is issued. Reauthentication with a valid incoming session rotates it atomically: the old session is revoked with safe history and a distinct new session and cookie are created. A failed transaction leaves no partial rotation.

S02-T02 onboarding first commits invitation acceptance, identity linking, employee activation, and account activation in its irreversible onboarding transaction. T04 session issuance follows as a separate transaction. On success the response is `ONBOARDING_COMPLETED`, `sessionCreated: true`, and `SESSION_ESTABLISHED`. If post-acceptance session issuance fails, onboarding remains committed, the invitation remains used, no cookie is set, and the response is `ONBOARDING_COMPLETED`, `sessionCreated: false`, and `SIGN_IN_REQUIRED`. The user signs in normally and is never told to reuse the invitation.

## Self-service API

- `GET /api/v1/me/sessions` lists only the current account's safe current and historical session metadata.
- `POST /api/v1/me/sessions/:id/revoke` revokes one owned session idempotently and clears the cookie when it is current.
- `POST /api/v1/me/sessions/revoke-all` requires `{ "includeCurrent": boolean }`. `false` preserves the current session; `true` revokes it and clears the cookie.

Revocation preserves rows and history; there is no hard-delete or `DELETE` route.

## Administration boundary

- `GET /api/v1/admin/sessions`
- `POST /api/v1/admin/sessions/:id/revoke`
- `POST /api/v1/employees/:id/sessions/revoke-all`

These endpoints accept only the narrow `SessionAdministrationAuthorizationPort`. Its production/default adapter always denies. An allow adapter can be injected only when `APP_ENV=test`. There is no Founder, email, role-name, job-title, or direct `RolePermission` shortcut. Repository predicates derive organization scope from the trusted session principal; cross-organization reads and mutations return safe empty/not-found outcomes.

The exported `SessionPrincipal` contains only trusted session identity, assurance evidence, and relevant timestamps. S02-T07 may consume this principal in the future, but T04 does not provide a final authorization result.

## Events and transactionality

Every real session mutation commits the session row together with mandatory organization-scoped audit history, security history, and outbox persistence:

- `SessionCreated.v1` → `identity.session-created` version 1
- `SessionRevoked.v1` → `identity.session-revoked` version 1
- `AllSessionsRevoked.v1` → `identity.all-sessions-revoked` version 1

Forced audit, security, and outbox failures roll back the mutation and any earlier history writes. Idempotent repeated commands do not emit duplicate mutation history. The T06 organization-null audit exception remains limited to `system.permission.register` and is not broadened for sessions.

`SessionExpired.v1` is **NOT EMITTED** in T04. Direct expiry enforcement is authoritative. A later operations requirement may add materialized expiry reporting without changing request denial.

## Concurrency and lock order

PostgreSQL concurrency tests exercise operations without timing sleeps. The stable lock order is:

1. Resolve reference identifiers without treating them as authority.
2. Lock organization/employee/account owners in sorted organization-and-employee order.
3. Lock session rows in stable session-ID order.
4. Apply the conditional mutation.
5. Append audit, security, and outbox history inside the same transaction.

This order serializes two single revokes, two revoke-all commands, issue versus revoke-all, touch versus revoke, exact-expiry touches, and reauthentication rotation versus revoke. A revocation cannot be undone by touch, command history is not duplicated, and concurrent issuance/revoke-all resolves to either a newly issued active session after the command or a session included in the command—never a partial credential state.

## Configuration and observability

The API requires explicit bounded `SESSION_IDLE_TTL_SECONDS`, `SESSION_ABSOLUTE_TTL_SECONDS`, and `SESSION_ALLOWED_ORIGINS`. Idle lifetime must not exceed absolute lifetime. Staging and production have no hidden session TTL defaults and require at least one exact origin. Session metrics use bounded operation/outcome/category labels and contain no raw credential or high-cardinality session/user label.

## Frontend

`/account/sessions` uses `credentials: include`, shows current and historical browser activity and expiry, supports single revoke, revoke-all-others, and sign-out-everywhere, and handles loading, empty, unauthenticated, result, and error states.

`/admin/sessions` is a bounded organization session view with employee filtering, single revoke, employee revoke-all, and loading, empty, unauthorized, forbidden, not-found, and generic error states. Its copy explicitly reflects the fail-closed pre-T07 administration boundary. Neither page reads `document.cookie` or uses local/session storage.

## Deferred ownership

- S02-T07 owns final application authorization.
- S02-T13 owns suspension/offboarding commands and will call the existing `revokeAllForEmployee` port while request-time lifecycle checks remain fail closed.
- Provider logout remains distinct from Dar Tech application-session revocation.
- Session history retention and cleanup policy are deferred; direct validity and denial do not depend on retention cleanup.
- Production identity-provider selection remains outside T04.
