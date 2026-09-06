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

## Issuer authority after issuance

Activation rechecks the issuer's current delegation authority after approval
and before the approved mutation claims or completes T09 execution. If that
authority has been removed, activation is denied, the temporary grant remains
pending, and neither approval-execution success nor grant evidence is written.

Once a temporary grant has been successfully issued while the issuer was
authorized, later loss of the issuer's own role or permission does not silently
revoke the issued grant. The grant remains effective only while all of its own
conditions remain valid: status `GRANTED`, `starts_at <= now < expires_at`, no
revocation, the same organization, an active recipient employee, an
authentication-eligible recipient account, a valid current recipient session,
an active and valid canonical permission, an exact scope/resource match, and
all current central policy requirements. The central `AuthorizationService`
continues to make the final decision on every request.

Ordinary recipient role authority and issued temporary authority are separate.
Removing the recipient's ordinary role assignment or role permission does not
remove an otherwise-valid temporary grant. That grant still ends immediately
through its own revocation or expiry, or when another current recipient,
permission, scope, organization, session, or policy condition fails.

## Persistence, evidence, and operations

The additive migration `20260905180000_sprint_02_t10_temporary_access` creates
`temporary_access_grants` and command-immutable permission/scope binding
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
`TEMPORARY_ACCESS_MAX_DURATION_SECONDS` (required; the Compose/example value is seven days).

## Verification record

Focused unit coverage exercises strict input validation, no credential fields,
wildcard/unknown permission rejection, duplicate binding rejection, duration
bounds, and authorization-source active/revocation/expiry filters.

The PostgreSQL suite `temporary-access.integration.spec.ts` uses the real
AppModule, T04 session resolution, T07 final authorization engine, T09 approval
service, and persisted grants. Its regression matrix covers:

| Requirement | Evidence |
| --- | --- |
| Before start, active interval, exact/after expiry | Injected-clock checks, including the final active millisecond; stored status remains GRANTED without a worker |
| Revoked, inactive/disabled recipient, removed permission, revoked session | Previously trusted principal loses access on the next central decision |
| Wrong organization/resource/type | Exact descriptor negative tests |
| Issuer delegation containment | Explicit issuer cannot issue an organization grant; removed issuer authority denies creation |
| T09 approval | Pending grant denies access; a different approver approves; exact command replay consumes one approval and emits one grant event |
| Post-approval authority removal | After approval, removal of the issuer's delegated permission makes exact command replay fail; the grant remains pending, T09 remains ready, no grant audit/event is written, and no alternate authority exists |
| Authority after issuance | Removing the recipient's ordinary role assignment leaves equivalent issued temporary authority active; later issuer permission loss also leaves the issued grant active, and revoking that temporary grant then denies access |
| Idempotency and no renewal | Concurrent creation produces one grant; changed expiry with the same key conflicts |
| Revoke/expiry races | Simultaneous revoke and reconciliation produce one terminal event; later reconciliation cannot change a revoked grant |
| Mandatory audit/outbox | All lifecycle event counts asserted; forced audit/outbox failure rolls back grant, bindings and approval |
| Bounded input and trusted requests | Required reason/start/expiry, wildcard/client-policy rejection, cookie authentication and CSRF |

The CI amendment removes formatting-only changes from existing files and fixes
runtime defects revealed by these tests: explicit Nest lookup injection,
PostgreSQL advisory-lock execution, inherited organization ownership in nested
binding creation, and T12 actor/change-field validation. Prisma relation names
map to the unchanged additive migration's foreign keys, eliminating naming drift.
No permission keys, policy rules, or emergency-access behavior are added.
