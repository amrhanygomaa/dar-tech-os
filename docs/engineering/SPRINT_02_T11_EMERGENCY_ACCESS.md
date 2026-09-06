# Sprint 02 T11 — Emergency Access Foundation

Status: **AUTHORIZED — IMPLEMENTATION UNDER REVIEW**. This record covers only
S02-T11. S02-T13 through S02-T15, offboarding, bootstrap administration,
production SSO selection, business modules, and business approval thresholds
remain unauthorized. T11 is not complete before supervisor review and merge.

## Security objective and boundary

Emergency access is an exceptional, organization-scoped, reason-required,
time-limited and explicitly bounded alternate authorization source. It is not
Super Admin, standing access, a credential, or a bypass. The requester needs
the existing `admin.access.emergency` permission and revocation needs
`admin.access.revoke`; T11 adds no permission keys.

The production `AuthorizationEmergencyGrantSource` projects only bounded
`AuthorizationGrant` descriptors. `AuthorizationService` remains the sole
component that can return an allow decision and still evaluates organization,
canonical permission validity, scope, current policy, current employee/account
eligibility, the exact current session, lifecycle state, and trusted time.
Lookup or policy failure returns no descriptors and therefore fails closed.

## Schema and lifecycle

The single additive migration
`20260906120000_sprint_02_t11_emergency_access` adds:

- `emergency_access_grants`, containing requester/recipient snapshots, bounded
  reason, requested/effective risk, requested window, activation and expiry,
  policy/context fingerprints, T09 approval reference, trusted step-up
  assurance/time, denial/revocation evidence, idempotency digests and version;
- `emergency_access_bindings`, containing normalized canonical permission and
  immutable permission-risk/scope/resource snapshots; and
- restrictive organization-composite foreign keys, checks, uniqueness, and
  lookup/expiry indexes.

No emergency credential, password, token, generic history table, hard delete,
renewal, or duration-extension model exists.

```text
request → PENDING_APPROVAL ── approval ──┐
       └→ ACTIVATION_ELIGIBLE ───────────┴→ explicit activation → ACTIVE
request/activation → DENIED              ACTIVE → REVOKED | EXPIRED
```

Request, approval, and step-up never activate the grant automatically. The
explicit activation command revalidates the requester, current session,
`admin.access.emergency`, recipient eligibility, trusted step-up, exact policy
version/fingerprint/context, approval evidence, risk, bindings and window.
Where approval is required, T09 claim, grant activation and T09 completion
share one transaction. Advisory and row locks make request creation,
activation, revocation and expiry retry-safe and concurrency-safe.

## Risk, time, step-up, and approval

Risk vocabulary is exactly `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. Effective risk
is the maximum of requested risk, every canonical bound-permission risk, and
the canonical `admin.access.emergency` workflow risk. Because that workflow is
currently `CRITICAL`, every T11 grant is currently effective `CRITICAL`; a
client can never downgrade it.

Both start and expiry are mandatory and the duration must not exceed the
startup-validated `EMERGENCY_ACCESS_MAX_DURATION_SECONDS`. Eligibility uses
the injected server clock and the half-open interval `startsAt <= at <
expiresAt`. At the exact expiry instant access is denied even if persisted
status remains `ACTIVE` and the worker has not run.

T11 reuses T04 trusted session assurance and `lastStepUpAt`; request fields
cannot supply step-up evidence. Freshness and assurance come from the current
validated T09 policy. T11 accepts only explicit `STEP_UP_ONLY` or
`STEP_UP_AND_APPROVAL` emergency policies. The production compatibility
`NO_APPROVAL` policy is deliberately rejected, so an environment without a
configured emergency policy/approver binding fails closed. No job title,
management override, or business threshold is invented.

## Exact scope, provenance, and material use

Bindings reject unknown or wildcard permission, scope, resource and malformed
resource identifiers. Organization scope has no resource ID; every narrower
scope has an exact resource binding and continues through the registered T08
scope resolver. Cross-organization and unrelated action/resource requests
deny.

The central authorization result carries a bounded, server-authored internal
source marker and emergency grant reference only when the emergency descriptor
actually matched. Normal role descriptors are evaluated first, followed by
T10 temporary descriptors, then emergency descriptors. This preserves prior
semantics and prevents false emergency-use attribution.

The `EmergencyAccessMaterialUseRecorder` is called by an owning material
mutation after authorization and with that mutation's database transaction.
For Sprint 02, a material use is a state-changing owning application command
whose allow decision was actually supplied by an emergency descriptor. Reads
are not automatically counted. Denied decisions, ordinary/T10 matches, and
rolled-back owning mutations produce no `EmergencyAccessUsed.v1` success
evidence. The recorder never grants authority itself.

## Evidence, alerts, observability, and UI

Every meaningful lifecycle transition appends transaction-critical T12 audit
and high-priority security evidence plus its outbox record:

- `EmergencyAccessRequested.v1`
- `EmergencyAccessActivated.v1`
- `EmergencyAccessDenied.v1`
- `EmergencyAccessUsed.v1`
- `EmergencyAccessRevoked.v1`
- `EmergencyAccessExpired.v1`

Payloads are bounded and omit credentials, tokens, raw step-up protocol data,
arbitrary request bodies, and metric identifiers. Required audit, security and
outbox writes roll back the owning transition on failure. The bounded alert
hook is best-effort because persisted evidence is authoritative; alert failure
cannot create or remove authorization. Metrics cover requested, activation
success/denial, active, material use, revoked and expired with only bounded
category and risk labels.

The internal page supports request, list, detail, explicit activation and
revocation. It shows requester/recipient, reason, risk, exact bindings, window,
approval/execution, trusted step-up snapshot, lifecycle, active countdown, and
up to 100 safe T12 lifecycle/material-use entries. It prominently states that
emergency access is not a universal bypass. The API remains the enforcement
authority.

## API and worker

OpenAPI exposes exactly:

- `POST /api/v1/emergency-access/requests`
- `GET /api/v1/emergency-access`
- `GET /api/v1/emergency-access/:id`
- `POST /api/v1/emergency-access/:id/activate`
- `POST /api/v1/emergency-access/:id/revoke`

Unsafe routes use the existing exact-Origin check before session resolution.
There is no generic PATCH, DELETE, execute, renew, extend, credential, or bypass
route. The worker reconciles expired persisted state and evidence using row
locks. It is idempotent and retry-safe; downtime cannot extend authority.
Revoke versus expiry produces one terminal transition/event.

## Verification evidence

- Unit suite: **314 tests across 58 files — PASS**.
- PostgreSQL suite: **195 tests across 13 files — PASS — no skips**, including
  18 focused T11 tests and T04/T06/T07/T08/T09/T10/T12 regressions.
- Fresh migration on isolated database `dartech_os_t11_20260906_a`: **PASS**;
  migration status current and schema drift zero.
- Canonical T10 schema to T11 migration on
  `dartech_os_t11_upgrade_20260906_a`: **PASS**; sentinel organization
  preserved and post-upgrade schema drift zero.
- Docker runtime `dartech_os_t11_runtime_20260906_a`: migration job exited
  successfully; PostgreSQL, API, web and worker healthy; health and web return
  200; unauthenticated access returns 401; valid-session missing/foreign Origin
  return 403 without touching the session; production's unconfigured emergency
  policy returns 403 fail-closed; OpenAPI contains exactly the five T11 paths.
- Full local `npm run quality:gate`: **PASS**, including clean install, lint,
  Prisma generate/validate/deploy/status/drift, typecheck, both test suites,
  production build, and Compose validation.
- Permission registry: expected **31**, new T11 keys **none**.

Exact commit SHA, PR and GitHub exact-head quality-gate evidence are recorded in
the PR/final implementation report after those checks complete.

## Known limitations

- No production emergency policy or approver binding is selected by T11; the
  production default therefore fails closed until separately configured.
- The alert contract persists/outboxes evidence but selects no external vendor.
- Material-use recording is an internal owning-command seam; each future
  business mutation must opt in within its own transaction.
- Persisted expiry state may lag during worker downtime, while authorization
  expiry remains immediate and worker-independent.
- The preserved legacy local `dartech_os` database retains its pre-existing T02
  invitation migration/checksum drift and is not modified or described as
  drift-free.
