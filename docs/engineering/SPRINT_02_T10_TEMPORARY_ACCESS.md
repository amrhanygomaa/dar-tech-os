# Sprint 02 T10 — Temporary / Delegated Access

Status: **AUTHORIZED — IMPLEMENTATION UNDER REVIEW**. This record covers only
S02-T10. It neither implements nor authorizes emergency access (S02-T11),
offboarding, business relationship data, bootstrap data, or later tickets.

## Security model

Temporary access is an explicit, recipient-bound, time-bounded grant. A request
contains canonical permission keys and exact resource/scope descriptors; it
cannot contain credentials, tokens, wildcard permissions, or wildcard scopes.
The issuer must be an active employee and must already pass the central
`AuthorizationService` check for every descriptor. Organization access can be
delegated only from organization access; extension scopes can be delegated only
by an organization-scoped issuer grant. An explicit issuer check is evaluated
against the exact requested resource.

The T10 source contributes descriptors only through
`AuthorizationTemporaryGrantSource`. The central authorization service remains
the only component that evaluates permissions, scope, policy, session/account
state, and the final allow decision. The source includes only granted,
unrevoked records for the recipient's current organization, active account, and
currently valid session, where `starts_at <= at < expires_at`. Source errors
therefore fail closed in central authorization.

## Lifecycle and approval

```text
request → PENDING_APPROVAL ── approved replay ──→ GRANTED
       └──────────────── no approval required ─→ GRANTED
GRANTED → REVOKED
GRANTED → EXPIRED
```

The T09 policy seam decides whether the `admin.access.temporary` request needs
approval or step-up. When required, the approval request is bound to recipient,
canonical binding fingerprint, reason fingerprint, and the requested start/end
window. There is intentionally no generic approval execution endpoint:
repeating the same idempotent command with its approved reference claims and
completes T09 within the same transaction that activates the grant.

At the expiry instant access is denied directly by the authorization query; the
worker is reconciliation and audit/outbox maintenance only. Revocation locks
the grant and takes effect immediately. Repeated revocation is idempotent.

## Persistence, evidence, and operations

The additive migration `20260905180000_sprint_02_t10_temporary_access` creates
`temporary_access_grants` and immutable-per-grant permission/scope binding
snapshots, organization boundaries, foreign keys, status/time checks, indexes,
and one idempotency digest per issuer/organization. Writes use advisory-key and
row locks to serialize duplicate creation, approval activation, revocation, and
expiry races.

Each request, grant, revocation, and expiry appends a minimized audit entry and
an outbox event (`identity.temporary-access-requested|granted|revoked|expired`).
Payloads identify safe grant/account references and time bounds; no credential
or secret material is persisted or emitted. The worker reconciles expired
grants transactionally and idempotently.

The API exposes only list, create/request, detail, and revoke routes under the
existing `admin.access.temporary` and `admin.access.revoke` permissions. The
admin page renders status, exact bindings, time bounds, reason, approval state,
and a revoke action where authorized. Runtime configuration bounds a request to
`TEMPORARY_ACCESS_MAX_DURATION_SECONDS` (default seven days).

## Verification record

Focused unit coverage exercises strict input validation, no credential fields,
wildcard/unknown permission rejection, duplicate binding rejection, duration
bounds, and authorization-source active/revocation/expiry filters. The full
repository quality gate remains required before this implementation is claimed
complete or submitted for review.
