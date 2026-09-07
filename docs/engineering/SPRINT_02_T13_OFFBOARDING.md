# Sprint 02 T13 — Employee Offboarding

Status: **AUTHORIZED — IMPLEMENTATION UNDER REVIEW**. This record covers S02-T13 only. S02-T14, S02-T15, bootstrap administration, production SSO selection, business modules, generic lifecycle editing, deletion, reactivation, and ownership-transfer workflows remain unauthorized and unimplemented.

## Lifecycle and security barrier

T13 adds only these explicit transitions:

```text
ACTIVE -> SUSPENDED
ACTIVE | SUSPENDED -> OFFBOARDING
OFFBOARDING (cleanup complete) -> ARCHIVED
```

`POST /api/v1/employees/:id/suspend` uses `admin.employee.suspend`; `POST /api/v1/employees/:id/offboard` and `POST /api/v1/employees/:id/archive` use `admin.employee.offboard`. There is no generic lifecycle PATCH, archive permission, deletion, resume, reactivation, unsuspend, unarchive, or bulk lifecycle command. The canonical permission registry remains 31 definitions.

The suspension/offboarding transaction locks the exact organization-scoped Employee and UserAccount, advances the lifecycle/version, sets `authenticationEligible = false`, preserves the first `disabledAt`, and writes required T12 evidence plus the transactional outbox record. This committed barrier precedes secondary cleanup. Existing T03 authentication, T04 session resolution, and T07/T10/T11 request-time eligibility checks therefore deny independently of cleanup progress. Cleanup failure never restores authentication or the prior lifecycle.

Suspension reuses T04 `SessionService.revokeAllForEmployee` with lifecycle-revocation evidence. An already suspended employee is idempotent and account ineligibility is repaired if necessary. Roles and grant history are not deleted.

## Approval and policy behavior

Offboarding reuses T09. The initial command prepares evidence bound to organization, requester, target, `admin.employee.offboard`, current lifecycle/account state, reason fingerprint, access impact, current policy fingerprint/version, and idempotency material. Approval does not mutate the Employee; the exact command and approval reference must be replayed.

Execution reauthorizes the current actor/session/organization/permission/scope, resolves the current policy, verifies exact approval context, claims the approved action, commits the barrier and evidence, and completes the T09 execution in one transaction. Rejected, wrong-target, wrong-reason, wrong-requester, stale-policy, removed-authority, and invalid step-up evidence deny without transitioning. Production compatibility `NO_APPROVAL` is explicitly rejected for offboarding. No approver identity, title, or business hierarchy is hard-coded; test-only policy adapters demonstrate the flow. Self-targeting has no bypass and remains subject to central authorization and configured approval separation.

## Staged cleanup and recovery

After the barrier, cleanup is retryable and organization-scoped:

1. T04 revokes every target application session.
2. Active target EmployeeRole rows receive `removedAt`, `removedByEmployeeId`, and the bounded removal reason; Role definitions remain intact.
3. T10 `PENDING_APPROVAL`/`GRANTED` authority where the target is recipient is ended with existing revocation/expiry evidence.
4. T11 `PENDING_APPROVAL`/`ACTIVATION_ELIGIBLE`/`ACTIVE` authority where the target is recipient is ended with existing lifecycle evidence.
5. A locked verification proves no effective sessions, target roles, T10 recipient authority, or T11 recipient authority remain before completion is recorded.

T10 grants issued by the target to another recipient and T11 grants requested by the target for another recipient are deliberately preserved. Cleanup does not rewrite those established issuer/requester semantics. Creation/activation paths lock and recheck current recipients so cleanup completion cannot race with newly persisted target authority.

`PENDING`, `INCOMPLETE`, and `COMPLETED` are persisted with bounded attempt/completion timestamps, failure category, and four nonnegative counters. A failed stage leaves OFFBOARDING plus the disabled account committed, appends audit and failed security evidence in a separate transaction, raises a bounded high-priority alert, and returns progress safe for exact-command retry. Concurrent cleanup uses employee and access-row locks; completion evidence is emitted once. Archive requires the barrier, disabled account, verified cleanup, and `COMPLETED`; repeated archive is idempotent.

## Schema, events, evidence, and observability

The additive `20260907120000_sprint_02_t13_offboarding` migration adds lifecycle version, initiating actor, source lifecycle, bounded reason, approval reference, cleanup status/timestamps/failure/counters, restrictive organization-composite foreign keys, checks, and indexes. It also permits a pending T10 grant to reach the existing `REVOKED` terminal state without fabricating a grant timestamp. It performs no delete or destructive rewrite.

The transactional outbox carries exactly the five T13 v1 contracts:

- `EmployeeSuspended.v1`
- `EmployeeOffboardingStarted.v1`
- `EmployeeAccessRevoked.v1`
- `EmployeeOffboarded.v1`
- `EmployeeArchived.v1`

T12 append-only audit/security records retain organization, actor/target snapshots and references, command transition, safe reason, approval reference, request/correlation/session reference, and bounded cleanup summary. A required audit failure rolls the associated critical mutation back. Employee, UserAccount, SSOIdentity, session, role, grant, approval, audit, and security history remains queryable after archive.

Metrics are bounded by operation, outcome, and fixed failure category only. No organization, employee, account, session, approval, request, permission, reason, or grant identifier is used as a metric label. Observability failure cannot grant authority.

## API, OpenAPI, and minimum UI

OpenAPI documents exactly the three POST commands, strict bodies, response states, approval-required behavior, authentication/CSRF denial, authorization denial, invalid transitions, and non-enumerating not-found behavior. Exact-Origin CSRF remains ahead of session resolution for credentialed unsafe requests.

The T13-owned employee administration page lists current lifecycle/account state and conditionally displays Suspend, Offboard/retry, and completed-cleanup Archive controls. It requires bounded reasons, explicit confirmation, displays safe approval/progress/count evidence, states immediate access impact and history preservation, and treats server denials as authoritative. It adds no T14 framework or destructive/reactivation control.

## Validation evidence

Focused T13 unit/source-contract coverage validates strict input, deterministic fingerprints, UI eligibility/confirmation/reason/progress boundaries, absence of delete/reactivation calls, and worker routing for all five contracts. The real PostgreSQL suite covers transitions and invalid states, session and authentication barriers, account/SSO preservation, approval replay/rejection/staleness/authority removal/`NO_APPROVAL`, forced cleanup failure and recovery, target role/T10/T11 cleanup, issuer/requester preservation, archive gates/idempotency, concurrency, non-enumeration/CSRF, exact event counts, and audit-coupled rollback.

Migration validation uses the isolated `dartech_s02_t13_validation` database. A fresh chain applied all 11 migrations, `prisma migrate status` reported current, and migration drift validation reported no difference. A separate canonical T11-to-T13 upgrade in `dartech_s02_t13_upgrade` preserved an ACTIVE employee/account and pending T10 sentinel exactly. Permission synchronization and validation reported 31 canonical and 31 persisted definitions.

The exact local `npm run quality:gate` passed from a clean `npm ci`: lint, Prisma generation/validation/deploy/status/drift, typecheck, 60 unit files with 328 tests, 14 real-PostgreSQL integration files with 205 tests, the production build (including `/admin/employees`), and `docker compose config --quiet`. Fresh Docker images for migrate, API, worker, and web then ran healthy against isolated `dartech_s02_t13_runtime`; all 11 migrations applied, OpenAPI exposed the three exact commands, web returned 200, and a controlled authorized suspension returned 200 while immediately disabling the account, revoking the target session, and making `/api/v1/me` return 401. Unauthenticated mutation returned 401 and a credentialed unsafe request without Origin returned 403. Exact-head GitHub `quality-gate` evidence is recorded in the PR/final implementation report after the remote check completes.

The older local `dartech_os` database retains its documented pre-existing T02 invitation schema/checksum drift and is not reset, repaired, deleted, or used as proof of zero drift. Previously reported one moderate and one high npm advisories are outside T13 and remain a caveat unless final audit evidence proves otherwise.
