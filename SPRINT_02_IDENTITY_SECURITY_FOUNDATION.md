# Dar Tech OS — Sprint 02
## Identity & Security Foundation
### Execution status: CONTROLLED IMPLEMENTATION — S02-T07 UNDER REVIEW
> S02-T00, S02-T01, S02-T02, S02-T03, S02-T04, S02-T05, S02-T06, and S02-T12 are completed. S02-T04 was merged through PR #10 at `2e7d5bbc8e4bddfeb85b8c5be18582f26eded996`. S02-T07 is explicitly authorized and its bounded implementation is under review. S02-T08 through S02-T11 and S02-T13 through S02-T15 remain unauthorized.

## Sprint objective

Build the identity, authentication, authorization, session, approval, security-event, and access-lifecycle foundation required before any Dar Tech OS business module is implemented.

## Source references

- `CODEX_MASTER_EXECUTION_PROMPT.md`
- `docs/SOURCE_OF_TRUTH.md`
- `docs/execution/SPRINT_01_CLOSURE.md`
- `docs/execution/PHASE_23_MASTER_PRD.md`
- `docs/security/PHASE_24_PERMISSIONS_APPROVALS_API.md`
- `docs/execution/PHASE_26_IMPLEMENTATION_BACKLOG.md`
- `docs/execution/PHASE_27_CODEX_EXECUTION_MODEL.md`
- `docs/architecture/PHASE_17_STATE_MACHINES.md`
- `docs/architecture/PHASE_20_BACKEND_API_CODEX_BLUEPRINT.md`

## Authorization gate

Sprint 01 is closed. S02-T00, S02-T01, S02-T02, S02-T03, S02-T04, S02-T05, S02-T06, and S02-T12 are completed. S02-T07 is explicitly authorized and its bounded implementation is under review. S02-T08 through S02-T11 and S02-T13 through S02-T15 remain planning-only and unauthorized. Completion, pull-request approval, or merge of S02-T07 must not be inferred as authorization to begin any other ticket.

Under the current authorization, agents must not:

- implement any Sprint 02 application behavior outside the completed tickets and S02-T07;
- add production provider adapters, business relationship resolvers, approvals, temporary/emergency access behavior, offboarding, seeds, or bootstrap commands;
- mark S02-T08 through S02-T11 or S02-T13 through S02-T15 active, ready, or implementation-authorized; or
- continue into CRM or any later business module.

## Sprint boundaries

### In scope for the future implementation

- deterministic maintenance for the known Sprint 01 PostgreSQL integration-test timestamp flake;
- internal employee identity and account lifecycle;
- invitation-only onboarding through a provider-neutral authentication contract;
- safe local/test authentication strictly for automated tests and local development;
- session creation, inspection, expiry, and revocation;
- customizable multi-role authorization and a stable permission registry;
- central server-side authorization and extensible resource-scope resolution;
- approval, temporary access, emergency access, audit, and security-event foundations;
- offboarding that removes active access while preserving history; and
- the minimum internal UI and API surface required to operate those capabilities.

### Out of scope

- CRM, Sales, Quotations, Contracts, Projects, Finance, Licensing, Warranty, Support, Knowledge, and Jira modules;
- Customer accounts, a customer portal, and public signup;
- a complete HR or organization-management system;
- production commitment to Google Workspace, Microsoft Entra ID, or any other SSO provider;
- production AI or MCP implementation;
- financial, licensing, warranty, export, discount, or other business-domain approval thresholds;
- fake Project, Customer, Team, or Department business records created only to satisfy authorization tests; and
- unrestricted local-password login or a production authentication bypass.

## Global implementation rules

When implementation is separately authorized:

1. Deliver bounded vertical slices through schema, domain/application rules, API, permissions, events, frontend, tests, observability, and documentation.
2. Keep controllers thin and keep business/security rules in application or domain services.
3. Enforce organization boundaries in repositories, use cases, authorization queries, unique constraints, and tests. A caller-supplied `organization_id` is never trusted as proof of access.
4. Use the central `authorize(actor, action, resource, context)` contract for Web, API, future AI, and future MCP callers. No direct-database authorization shortcut is allowed.
5. Deny by default when identity, account state, permission, scope, policy context, or a scope resolver is missing or invalid.
6. Store timestamps in UTC. Expiry checks must use an injected clock and must not depend on a background job running on time.
7. Store no plaintext invitation token, session token, SSO secret, authorization code, refresh token, access token, or emergency-access credential in the database, application logs, audit data, or security events.
8. Preserve append-only assignment, approval, access, security, and audit history where required. Normal workflows archive or revoke records; they do not hard-delete historical actors or references.
9. Use explicit commands for lifecycle and sensitive actions. Generic status patches must not bypass validation, authorization, approval, step-up, event, or audit rules.
10. Keep OpenAPI current and use the existing `/api/v1` response/error/request-ID conventions.

## Planned delivery order

Ticket IDs identify scope; dependencies determine execution order. The recommended sequence after explicit authorization is:

```text
S02-T00
→ S02-T01
→ S02-T03 + S02-T05 + S02-T06 + S02-T12 foundation
→ S02-T02 + S02-T04 + S02-T07
→ S02-T08 + S02-T09
→ S02-T10 + S02-T11 + S02-T13
→ S02-T14
→ S02-T15
```

Parallel work is permitted only where dependencies are satisfied and the supervisor has authorized the affected tickets.

## Ticket execution record

| Ticket | Status | Evidence |
| --- | --- | --- |
| S02-T00 | COMPLETED | PR #3; merge commit `e3f0cab99469334058657e73015c1667c562a3e5` |
| S02-T01 | COMPLETED | PR #4; merge commit `188dd268a3bfbace0d5341a069fc403d4ff111d4` |
| S02-T03 | COMPLETED | PR #5; merge commit `fbbe0e1cf65f4ca274d4c97bc3eeaad241c64aec` |
| S02-T12 | COMPLETED | PR #6; merge commit `81dc731123d95ecc8376867b27efe1c23e7b8119` |
| S02-T02 | COMPLETED | PR #7; merge commit `9f27434a292c557d18254eea0b84355c1c1693a2` |
| S02-T05 | COMPLETED | Implemented before the explicit S02-T06 authorization; see `docs/engineering/SPRINT_02_T05_ROLE_MODEL.md` |
| S02-T06 | COMPLETED | PR #9; merge commit `48f5327928cedd8cb1c7a531e9a3cb0c40f5599c`; evidence in `docs/engineering/SPRINT_02_T06_PERMISSION_REGISTRY.md` |
| S02-T04 | COMPLETED | PR #10; merge commit `2e7d5bbc8e4bddfeb85b8c5be18582f26eded996`; evidence in `docs/engineering/SPRINT_02_T04_SESSION_MANAGEMENT.md` |
| S02-T07 | AUTHORIZED — IMPLEMENTATION UNDER REVIEW | Bounded central-authorization implementation and evidence in `docs/engineering/SPRINT_02_T07_CENTRAL_AUTHORIZATION.md` |
| S02-T08 through S02-T11 and S02-T13 through S02-T15 | NOT AUTHORIZED | No implementation may begin without a later explicit supervisor authorization |

## Planned schema boundaries

The following is the maximum Sprint 02 entity scope. Exact column names and indexes may be refined during an authorized ticket without changing the business policy in this specification.

| Area | Planned entities/value types | Boundary |
| --- | --- | --- |
| Identity | `Organization`, `Employee`, `UserAccount`, `SSOIdentity`, `Invitation` | Internal employees only; all mutable identity records are organization-scoped. |
| Sessions | `Session` | Opaque/hashed session identifiers, metadata minimization, expiry and revocation. |
| Roles | `Role`, `EmployeeRole` | Customizable roles and historical multi-role assignments. |
| Permissions/scopes | `Permission`, `RolePermission`, `ScopeType`, explicit scope bindings where needed | Permission definitions are a product registry; grants and bindings are organization-scoped. |
| Approval | `ApprovalRequest`, `ApprovalStep`, append-only approval history/execution metadata | Generic identity/security foundation only; no business-domain thresholds. |
| Temporary/emergency access | `TemporaryAccessGrant`, grant permission/scope bindings, `EmergencyAccessGrant` | Explicit, time-bounded, revocable, reasoned, fully audited access. |
| Security/audit | `SecurityEvent`, `AuditEvent` | Historical actor/context snapshots without secrets or token material. |

Every organization-owned table must carry `organization_id`, use an organization-consistent relation strategy, and have cross-organization negative tests. The `Permission` registry may be product-global because its stable keys describe application capabilities rather than tenant-owned data; `Role`, `RolePermission`, assignments, grants, approvals, sessions, and events remain organization-scoped.

## Employee and account lifecycle

The canonical employee lifecycle is:

```text
Invited → Active → Suspended → Offboarding → Archived
```

- `Invited` is reached only through a valid invitation/bootstrap path.
- `Active` requires successful authentication identity binding and completed onboarding.
- `Suspended` prevents new authentication and invalidates active sessions without deleting history.
- `Offboarding` is an explicit command that revokes sessions and active access and preserves ownership/audit references.
- `Archived` is the terminal normal-workflow state. Employees are not permanently deleted as part of ordinary operations.
- Reversal/reactivation behavior outside the approved transitions is not part of Sprint 02 and must not be invented.

## Authentication and onboarding contract

The planned internal flow is:

```text
Invitation
→ provider-neutral authentication/SSO
→ verified invitation/identity binding
→ onboarding completion
→ active account and session
```

- No public signup route or customer-account path exists.
- Invitation secrets are single-use, random, short-lived, and stored only as secure hashes.
- Expired, revoked, accepted, organization-mismatched, or identity-mismatched invitations fail closed.
- Provider subject identifiers, not mutable display names, are the durable external identity key.
- A safe local/test adapter may be enabled only in automated test and local development profiles. Startup must fail if a local/test bypass is enabled in staging or production.

## Central authorization contract

All protected operations use the canonical contract:

```text
authorize(actor, action, resource, context)
```

The decision considers:

```text
authenticated identity
+ employee/account/session lifecycle
+ all active role assignments
+ stable permissions
+ scope and resource relationship
+ temporary/emergency access
+ policy/risk/step-up context
+ organization boundary
```

The decision result must be explicit and machine-usable, including allow/deny and a safe reason code. Sensitive authorization decisions must be traceable without logging secrets or unnecessary personal data. Frontend visibility may reflect a decision but is never the enforcement boundary.

## Scope contract

Sprint 02 supports these approved scope types:

```text
SELF
ASSIGNED
TEAM
DEPARTMENT
PROJECT
CUSTOMER
ORGANIZATION
EXPLICIT
```

- `SELF`, `ORGANIZATION`, and identity-resource `EXPLICIT` checks can use Sprint 02 data.
- `ASSIGNED`, `TEAM`, `DEPARTMENT`, `PROJECT`, and `CUSTOMER` are implemented behind typed resolver interfaces.
- A missing resolver or missing relationship denies access; it does not broaden to organization scope.
- Project and Customer references remain opaque authorization resource identifiers until their owning modules exist. Sprint 02 must not create Project or Customer tables, routes, pages, or fake records.
- Tests use resolver fakes/fixtures, not fake business modules.

## Planned Sprint 02 permission registry

Stable keys follow `<domain>.<resource>.<action>`. The initial registry is limited to the capabilities Sprint 02 needs:

```text
identity.account.read_self
identity.account.update_self
identity.session.read_self
identity.session.revoke_self

admin.employee.read
admin.employee.update
admin.employee.invite
admin.employee.suspend
admin.employee.offboard
admin.invitation.read
admin.invitation.revoke
admin.role.read
admin.role.create
admin.role.update
admin.role.archive
admin.role.assign
admin.permission.read
admin.permission.manage
admin.session.read
admin.session.revoke
admin.sso.read
admin.sso.manage
admin.access.temporary
admin.access.revoke
admin.access.emergency

approval.request.read
approval.request.approve
approval.request.reject

security.event.read
audit.event.read
```

Permission-key spelling is an API/security contract. Changes require documentation, migration/compatibility analysis where applicable, and supervisor review. `update` never implies `delete`; Sprint 02 defines no identity hard-delete permission. Future delete capabilities must use separate explicit permission keys.

## Approval policy contract

The approval engine must support these outcomes without embedding unapproved thresholds:

```text
NO_APPROVAL
SINGLE_APPROVER
SEQUENTIAL_APPROVAL
PARALLEL_APPROVAL
STEP_UP_ONLY
STEP_UP_AND_APPROVAL
```

Policies receive action, resource, actor, scope, organization, risk, and environment context. Approver resolution is an interface backed by authorized role/employee configuration, not a hard-coded founder or job title. Financial, licensing, warranty, discount, export, and production-deployment thresholds remain out of scope.

## Bootstrap administrator policy

**Status: SUPERVISOR APPROVED — IMPLEMENTATION NOT YET AUTHORIZED.**

The approved policy is:

- the first administrator uses a one-time bootstrap mechanism;
- bootstrap identity/email comes from explicit configuration and is never hard-coded;
- bootstrap is allowed only while zero active administrators exist;
- bootstrap is invoked only through an explicit local/operations management command;
- bootstrap never runs automatically at application startup;
- bootstrap never has a public HTTP endpoint;
- every bootstrap attempt and outcome is fully audited;
- bootstrap permanently disables after successful initialization;
- future normal employee creation uses invitation plus SSO; and
- Founder status gives no implicit administrative authority.

This policy approval does not authorize implementation, a seed, a management command, an endpoint, or any other bootstrap behavior in S02-T01. Implementation may begin only when the bootstrap-owning Sprint 02 ticket is explicitly authorized.

## Configuration values that must remain configurable

Invitation lifetime, session idle/absolute lifetimes, step-up freshness, temporary-access limits, emergency-access limits, retention periods, and production provider settings must not be hidden constants. Tests may use explicit fixtures. Production values and production identity-provider selection require later security/operational approval.

---

## S02-T00 — Foundation Test Determinism Maintenance

### Objective

Remove the documented Sprint 01 PostgreSQL timestamp-sensitive integration-test flakiness with deterministic timestamps, injected clock control, or another minimal reliable solution, without changing queue or outbox business semantics.

### Dependencies

- Closed Sprint 01 foundation and its documented technical debt.
- No Sprint 02 identity schema or behavior.

### Schema scope

- None.
- No migration or production table/column/default/index change is permitted for this maintenance ticket.

### API scope

- None.

### Permission scope

- None.

### Events

- No new or changed event type, payload, retry, deduplication, claim, lease, or delivery behavior.

### Frontend

- None.

### Tests

- Make immediate enqueue/write-and-claim integration assertions deterministic at PostgreSQL `timestamptz(3)` precision.
- Cover both queue and outbox reference flows.
- Repeat the affected integration suite enough times to demonstrate the flake is removed.
- Retain existing retry, lease, terminal failure, deduplication, transaction rollback, and idempotent consumer assertions.

### Observability

- No production logging/metric changes unless required solely to diagnose the test and approved within this ticket.
- Record the chosen deterministic-clock convention in engineering test documentation.

### Security considerations

- Test clock controls must not be exposed as a production runtime control.
- Do not weaken time-based expiry or lease validation.

### Acceptance criteria

- [x] The previously intermittent queue/outbox integration assertions pass deterministically across repeated runs.
- [x] Existing queue/outbox unit and integration tests still pass unchanged in meaning.
- [x] No Prisma migration or application schema change exists.
- [x] Queue/outbox claim eligibility, retry, lease, deduplication, and delivery semantics are unchanged.
- [x] Lint, typecheck, tests, and build pass.
- [x] The maintenance convention is documented.

### Acceptance evidence — 2026-09-01

- PostgreSQL diagnostics confirmed that `timestamptz(3)` rounding can place a just-written eligibility timestamp up to 427 microseconds ahead of the unrounded database comparison time.
- Immediate-claim integration fixtures now set queue jobs, outbox events, and generated outbox delivery jobs to an explicit fixed-past `availableAt` value. Production queue/outbox source and runtime configuration are unchanged.
- Queue integration suite: 20 consecutive successful runs.
- Outbox integration suite: 20 consecutive successful runs.
- `npm run quality:gate`: passed, including lint, typecheck, migration validation, 35 unit tests, 5 PostgreSQL integration tests, production build, and Docker Compose validation.
- Standalone `npm run test:unit`, `npm run test:integration`, `npm run build`, and `docker compose config`: passed.
- No Prisma schema change, migration, identity/security implementation, or S02-T01+ authorization was introduced.

### Do Not Change

- Do not change queue/outbox business semantics, production timestamp precision, retry policy, claim ordering, lease behavior, event contracts, or deduplication rules.

---

## S02-T01 — Organization / Employee / UserAccount Foundation

### Objective

Create only the identity/security aggregate required by Sprint 02: `Organization`, `Employee`, `UserAccount`, and `SSOIdentity`, with explicit organization scoping and the approved employee lifecycle.

### Dependencies

- S02-T00.
- Existing PostgreSQL/Prisma, transaction, request-ID, logging, error, outbox, and worker foundations.

### Schema scope

- `Organization`: identity/security tenant boundary and minimal display/audit timestamps; no broad organization-management model.
- `Employee`: `organization_id`, stable identifier, normalized internal identity fields, lifecycle status, lifecycle timestamps, and preserved historical references.
- `UserAccount`: `organization_id`, one-to-one employee ownership, activation/disable metadata, and authentication eligibility; passwords are not required.
- `SSOIdentity`: `organization_id`, account relation, provider key, immutable provider subject, verified normalized email where provided, link/last-auth timestamps, and uniqueness that prevents cross-account identity reuse.
- Approved lifecycle enum: `INVITED`, `ACTIVE`, `SUSPENDED`, `OFFBOARDING`, `ARCHIVED`.
- Restrictive foreign keys and indexes for organization-scoped lookup, normalized email, lifecycle status, account relation, and provider-subject lookup.

### API scope

- `GET /api/v1/me`
- `PATCH /api/v1/me` for approved self-service account/profile fields only.
- `GET /api/v1/employees`
- `GET /api/v1/employees/:id`
- `PATCH /api/v1/employees/:id` for non-lifecycle profile fields only.
- Lifecycle commands are owned by S02-T02 and S02-T13; generic status updates are rejected.

### Permission scope

- `admin.employee.read`
- `admin.employee.update`
- Self-account reads/updates are introduced only through the authenticated account contract.

### Events

- `EmployeeCreated.v1`
- `SSOIdentityLinked.v1`
- `UserAccountActivated.v1`
- Lifecycle events are emitted by their owning invitation, suspension, or offboarding commands.

### Frontend

- Data/query foundation for employee list and employee detail.
- No full HR screens, payroll, leave, recruitment, performance, or job-title authorization.

### Tests

- Organization isolation and cross-organization denial.
- Employee lifecycle transition rules and invalid transitions.
- Account-to-employee uniqueness.
- Provider-subject uniqueness and organization-safe identity lookup.
- No lifecycle mutation through generic employee update.
- Historical employee references use restrict/archive behavior rather than destructive cascades.

### Observability

- Safe structured logs for identity commands with request/correlation ID, organization ID, target ID, outcome, and stable error code.
- Metrics for identity lookup/command failures without email or provider-subject labels.

### Security considerations

- Normalize identity lookup fields consistently and prevent account enumeration in public/auth responses.
- Never infer authorization from employee job title or Founder status.
- Never expose provider tokens, internal stack traces, or cross-organization records.

### Acceptance criteria

- [x] The four planned entities and lifecycle constraints exist in an authorized migration.
- [x] Every mutable identity record is organization-scoped and cross-organization tests deny access.
- [x] An employee can have at most one internal account while an account can link provider identities safely.
- [x] Only approved explicit commands can alter lifecycle state.
- [x] Archived/historical employee references remain intact.
- [x] API validation, authorization, error contracts, OpenAPI, events, audit hooks, and tests are complete.

Acceptance evidence: migration `20260901165304_sprint_02_t01_identity_core`; 60 unit tests; 18 PostgreSQL integration tests; fresh and Sprint 01 upgrade migration validation; zero schema drift; production build; and healthy API, web, worker, and PostgreSQL containers. S02-T02 through S02-T15 remain unauthorized.

### Do Not Change

- Do not implement full HR, customer identities, public signup, hard-coded founder privileges, password login, or normal-workflow employee deletion.

---

## S02-T02 — Invitation & Onboarding

### Objective

Implement the internal invitation-only flow from invitation through provider authentication and onboarding to an active employee account, including expiry and revocation.

### Dependencies

- S02-T01 and S02-T03.
- S02-T12 audit/security-event persistence available before the ticket closes.

### Schema scope

- `Invitation`: `organization_id`, employee/account target, normalized invited email, secure token hash, status, issuer, issued/expiry/accepted/revoked/superseded timestamps, revoker/reason, superseding invitation reference, and audit timestamps. Multiple terminal historical invitations may reference the same employee/account.
- Invitation states: `PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`, `SUPERSEDED`; expiry is enforced from `expires_at`, and terminal invitations are never restored to `PENDING`.
- Onboarding completion metadata may live on the invitation/account; do not create an HR profile subsystem.

### API scope

- `POST /api/v1/employees/invite`
- `POST /api/v1/employees/:id/reinvite`
- `GET /api/v1/invitations`
- `POST /api/v1/invitations/:id/revoke`
- `POST /api/v1/invitations/:id/resend`
- Provider-neutral invitation inspection/authentication/onboarding commands under `/api/v1/auth` and `/api/v1/onboarding`.
- Raw invitation secrets must be redacted from logs, errors, analytics, and referrers.

### Permission scope

- `admin.employee.invite`
- `admin.invitation.read`
- `admin.invitation.revoke`
- `admin.invitation.resend`
- The invited user receives no general application permission before activation.

### Events

- `EmployeeInvited.v1`
- `InvitationAccepted.v1`
- `InvitationRevoked.v1`
- `InvitationExpired.v1` for observable expiry processing; enforcement cannot depend on event delivery.
- `InvitationSuperseded.v1`
- `InvitationReissued.v1`
- `OnboardingCompleted.v1`

### Frontend

- Internal invitation-management list and create/revoke/resend/re-invite actions with explicit one-time link copy.
- Invitation landing, provider-auth transition, expired/revoked/superseded/invalid states, and minimum onboarding completion screen.
- No public registration or customer onboarding UI.

### Tests

- Valid invitation to verified SSO identity to onboarding to active account.
- Expired, revoked, reused, unknown, organization-mismatched, and identity/email-mismatched invitation denial.
- Concurrent/double acceptance allows one successful result only.
- Concurrent resend/re-invite and resend versus accept/revoke/expiry preserve at most one usable pending invitation.
- Every resend/re-invite rotates the 256-bit secret, creates a new historical row, and invalidates old links.
- Token hashing/redaction and non-enumerating errors.
- Unauthorized invitation creation/read/revocation.
- Audit/security events for every lifecycle outcome.

### Observability

- Counts and safe outcome codes for invite issued, accepted, expired, and revoked.
- Alertable rate for repeated invalid/reused invitation attempts without token/email labels.

### Security considerations

- Use high-entropy single-use secrets, hash at rest, fixed-time comparison where applicable, short configurable lifetime, and secure transport.
- Bind acceptance to the intended organization and verified provider identity.
- Rate-limit externally reachable invitation/authentication validation paths.

### Acceptance criteria

- [x] There is no path to an active account without a valid invitation or separately approved bootstrap mechanism.
- [x] Expired, revoked, reused, and mismatched invitations fail closed.
- [x] Invitation acceptance is concurrency-safe and single-use.
- [x] Resend and re-invite preserve history, rotate secrets, and leave at most one usable `PENDING` invitation under concurrency.
- [x] `SUPERSEDED` is terminal and an old superseded token cannot authorize authentication or onboarding.
- [x] Successful onboarding produces the approved active lifecycle state and authenticated account relationship.
- [x] Invitation secrets never appear in persistence, logs, events, audit, URLs retained by analytics, or API responses after initial issuance.
- [x] API, UI states, OpenAPI, audit/security events, and PostgreSQL integration tests are complete.

### Acceptance evidence — 2026-09-02

- Added the organization-scoped `Invitation` entity and the single additive migration `20260902190000_sprint_02_t02_invitation_onboarding`. Fresh-database and canonical-main upgrade validation passed with existing sentinel data preserved, no schema drift, and no destructive change.
- Invitation issuance generates 256-bit random base64url secrets, persists only a SHA-256 digest, returns the fragment-based acceptance URL once under `Cache-Control: no-store`, and never exposes the digest or URL from list/revoke APIs.
- Invitation inspection, provider start, and acceptance directly enforce `current_time < expires_at`; exact-boundary, expired, revoked, reused, unknown, organization-mismatched, unverified-email, and verified-email-mismatch tests deny closed. The T03 pre-check and T02 acceptance path use the injected invitation clock.
- The T03 authentication transaction carries only the exact invitation UUID authorization reference. Existing state, nonce, PKCE, expiry, and replay protections remain intact, and callback input cannot substitute another invitation.
- PostgreSQL target-first employee/account locks, deterministic invitation-history locks, and conditional terminal updates enforce at most one usable `PENDING` invitation. Double-accept, accept/revoke, accept/expiry, resend/resend, re-invite/re-invite, resend/accept, and resend/revoke race tests prove one valid outcome.
- The supervisor-approved resend/re-invite amendment preserves multiple terminal invitation rows per employee/account, adds terminal `SUPERSEDED` metadata, and exposes `POST /api/v1/invitations/:id/resend` plus `POST /api/v1/employees/:id/reinvite`. Each successful command creates a new row, 256-bit secret, SHA-256 digest, and one-time fragment URL; an old token cannot authorize authentication after supersession.
- Successful acceptance atomically consumes the invitation, links `SSOIdentity`, sets `UserAccount.authenticationEligible=true`, transitions Employee `INVITED → ACTIVE`, completes onboarding, appends required T12 audit/security history, and persists all required outbox events. Forced failures at audit, SSO identity, account activation, employee activation, and outbox stages leave no partial active account.
- Resend transactionally records `InvitationSuperseded.v1` and `InvitationReissued.v1`; re-invite records `InvitationReissued.v1`. T12 audit/security history and outbox payloads contain the actor scope, old/new IDs, operation, safe outcome, and timestamps without token, digest, URL, or email. Forced history failure rolls the replacement and supersession back together.
- The onboarding UI removes the fragment immediately, keeps the secret only in React memory, uses POST bodies with no-referrer/no-store handling, and uses no local/session storage, cookie, or client logging. It safely identifies `SUPERSEDED` without exposing replacement details. The internal invitation UI covers create/list/revoke/resend/re-invite, explicit link copy, one-time/no-email messaging, and loading, empty, unauthorized, forbidden, and error states.
- Amendment migration validation passed on a fresh database and from the canonical-main schema with existing Organization, Employee, UserAccount, and SSOIdentity sentinel records preserved. Both resulting schemas report zero drift.
- `npm run quality:gate` passed with lint, Prisma validation/status/drift, typecheck, 122 unit tests, 63 PostgreSQL integration tests, production build, and Compose validation. The pre-existing two high-severity Prisma/mysql2 dependency advisories are unchanged.
- Rebuilt runtime validation passed: the T02 migration container exited 0; PostgreSQL, API, web, and worker are healthy; health/readiness, web, onboarding, internal invitation UI, Swagger UI, and OpenAPI probes returned the expected results; protected invitation management denied without a trusted actor.
- Runtime token-shaped error probes were not echoed or logged. OpenAPI exposes invitation secrets only as write-only request-body fields and contains no invitation token query/path parameter, public/customer signup, password registration/login, or application-session issuance route.
- S02-T04 and every other unauthorized Sprint 02 ticket remain deferred. No Session model, bearer/refresh token, bootstrap implementation, production provider, customer onboarding, or public signup was added. The pre-existing Prisma/mysql2 advisory and dependency versions are unchanged.

### Do Not Change

- Do not add public signup, customer accounts, password registration, automatic domain-wide enrollment, or a permanent invitation bypass.

---

## S02-T03 — SSO Provider Abstraction

### Objective

Define and implement a provider-neutral authentication contract with replaceable adapters, while permitting a tightly gated local/test adapter only for automated tests and local development.

### Dependencies

- S02-T01 identity contracts.
- Existing provider-abstraction ADR and runtime configuration foundation.

### Schema scope

- Reuse `SSOIdentity` from S02-T01.
- No provider access/refresh token table and no plaintext provider credential fields.
- Provider configuration and secrets use validated configuration/secret references, not business entities.

### API scope

- Provider capability discovery limited to configured internal sign-in options.
- Provider-neutral start/callback/failure/logout application commands under `/api/v1/auth`.
- Callback DTOs and adapter responses normalize provider subject, verified-email status, assurance/step-up evidence, and safe failure codes.

### Permission scope

- Authentication entry itself is invitation/account-state gated rather than role-permission gated.
- `admin.sso.read`
- `admin.sso.manage` for future protected configuration operations; no production configuration UI is required in this ticket.

### Events

- `AuthenticationSucceeded.v1`
- `AuthenticationFailed.v1` when provider data is available safely.
- `SSOIdentityLinked.v1`
- Security-event persistence is defined by S02-T12.

### Frontend

- Provider-neutral sign-in entry and safe authentication error/retry states.
- Provider names/icons are adapter metadata, not hard-coded domain behavior.

### Tests

- Contract tests shared by adapters.
- Verified/unverified identity, unknown subject, invited subject, inactive account, invalid state/nonce, provider failure, and replay denial.
- Local/test adapter works only in test/development and makes staging/production startup fail when enabled.
- Authentication errors do not disclose whether an employee/account exists.

### Observability

- Provider-key/outcome/latency metrics with bounded labels and no subjects, emails, codes, tokens, or state values.
- Correlated safe logs for start/callback/failure.

### Security considerations

- Require state/nonce and PKCE or equivalent provider-protocol protections where applicable.
- Validate issuer, audience, signatures, timestamps, redirect allowlists, and verified identity claims inside adapters.
- Never treat provider group/job-title claims as Dar Tech authorization.

### Acceptance criteria

- [x] Application/domain code depends on a provider-neutral contract, not a production vendor SDK.
- [x] At least one safe fake/local adapter proves the contract in automated tests and local development.
- [x] Local/test authentication cannot start in staging or production.
- [x] Authentication respects invitation and employee/account lifecycle state.
- [x] Secrets and provider token material are absent from logs, errors, audit, and normal database columns.
- [x] Contract tests, security-event hooks, OpenAPI, and configuration documentation are complete.

### Acceptance evidence — 2026-09-01

- `npm ci` and `npm run quality:gate` passed; Prisma validation, migration status, and drift checks confirm the existing two-migration schema is unchanged.
- Standalone lint, typecheck, build, and Docker Compose validation passed.
- Unit/API suites: 91 tests passed, including shared adapter/normalization, state, nonce, replay, provider failure, unverified identity, lifecycle/account, organization mismatch, enumeration, local-environment, log redaction, event, and OpenAPI coverage.
- PostgreSQL integration suites: 19 tests passed, including T01 organization isolation and identity linkage plus the T00/Sprint 01 queue/outbox regressions.
- `docker compose up --build -d --wait` passed. API, web, worker, and PostgreSQL reported healthy; API readiness, provider discovery, web, and OpenAPI returned successful responses.
- Provider discovery is empty in the default Docker runtime because the local adapter is disabled. Automated configuration and composition tests prove that enabling it in staging or production fails startup.
- No production provider SDK/configuration, Session/Invitation model, provider credential column, Prisma migration, SSO link action, application cookie/token, bootstrap implementation, role/permission system, or later-ticket behavior was added.
- Detailed architecture and deferred boundaries are recorded in `docs/engineering/SPRINT_02_T03_SSO_ABSTRACTION.md`; S02-T02 and S02-T04 through S02-T15 remain unauthorized.

### Do Not Change

- Do not commit to Google, Entra ID, or another production provider; do not add unrestricted production local login; do not map external groups directly to Dar Tech roles.

---

## S02-T04 — Session Management

**Status: AUTHORIZED — IMPLEMENTATION EVIDENCE PASSED; PULL-REQUEST REVIEW REQUIRED.**

### Objective

Provide secure active-session lifecycle management: metadata, idle/absolute expiration, self-service revocation, administrator revocation, revoke-all, and automatic invalidation for suspension/offboarding.

### Dependencies

- S02-T01 and S02-T03.
- S02-T12 audit/security-event hooks.

### Schema scope

- `Session`: `organization_id`, account/employee relation, opaque identifier hash, issued/last-seen/idle-expiry/absolute-expiry timestamps, revoked timestamp/reason/actor, authentication assurance and last step-up time, and minimized device/network metadata.
- Index active lookup, account sessions, expiry, and revocation without persisting raw credentials.

### API scope

- `GET /api/v1/me/sessions`
- `POST /api/v1/me/sessions/:id/revoke`
- `POST /api/v1/me/sessions/revoke-all`
- `GET /api/v1/admin/sessions` where authorized.
- `POST /api/v1/admin/sessions/:id/revoke`
- `POST /api/v1/employees/:id/sessions/revoke-all`

### Permission scope

- `identity.session.read_self`
- `identity.session.revoke_self`
- `admin.session.read`
- `admin.session.revoke`

### Events

- `SessionCreated.v1`
- `SessionRevoked.v1`
- `AllSessionsRevoked.v1`
- `SessionExpired.v1` may be emitted for operations/reporting, but request denial uses direct expiry checks.

### Frontend

- Account/session page showing safe device, approximate activity, expiry, current-session marker, and revoke actions.
- Authorized security-administration session view.

### Tests

- Active, idle-expired, absolute-expired, revoked, malformed, and organization-mismatched sessions.
- Revoke one, revoke all including/excluding current session according to explicit command, and idempotent repeated revocation.
- Suspension/offboarding invalidates every session transactionally or with fail-closed account-state checks.
- Cookies/token transport security appropriate to the chosen session strategy; CSRF tests where applicable.

### Observability

- Active/revoked/expired session counts and revocation outcome metrics without raw identifiers or high-cardinality user labels.
- Security events for create/revoke/failure where meaningful.

### Security considerations

- Use secure, HTTP-only, same-site cookies where browser sessions use cookies; document CSRF strategy.
- Rotate identifiers at authentication/privilege changes as appropriate and compare stored hashes safely.
- Account and employee state is checked on every protected request, not only at session issuance.

### Acceptance criteria

- [x] Expired or revoked sessions cannot authorize requests even if cleanup jobs have not run.
- [x] Users can inspect and revoke their own sessions without accessing other employees' metadata.
- [x] Authorized administrators can revoke one/all sessions within their organization only.
- [x] Suspension and offboarding prevent continued use of all existing sessions.
- [x] Raw session credentials never appear in persistence, logs, events, audit, or API payloads.
- [x] Session APIs, UI, OpenAPI, integration/security tests, audit, and events are complete.

### Do Not Change

- Do not create permanent sessions, plaintext bearer-token storage, cross-organization session administration, or cleanup-dependent authorization.

---

## S02-T05 — Role Model

### Objective

Support customizable organization roles and multiple concurrent role assignments per employee without job-title or Founder-based authorization shortcuts.

### Dependencies

- S02-T01.

### Schema scope

- `Role`: `organization_id`, stable ID, unique normalized name/key within organization, description, active/archived state, and audit timestamps.
- `EmployeeRole`: organization-consistent employee/role relation, assigned/effective timestamps, optional explicit expiry, issuer, revocation/removal metadata, and preserved history.
- No single `role_id` column on `Employee`; the many-to-many assignment is authoritative.

### API scope

- `GET /api/v1/roles`
- `POST /api/v1/roles`
- `PATCH /api/v1/roles/:id`
- `POST /api/v1/roles/:id/archive`
- `POST /api/v1/employees/:id/roles`
- `POST /api/v1/employees/:employeeId/roles/:roleId/remove`

### Permission scope

- `admin.role.read`
- `admin.role.create`
- `admin.role.update`
- `admin.role.archive`
- `admin.role.assign`

### Events

- `RoleCreated.v1`
- `RoleUpdated.v1`
- `RoleArchived.v1`
- `EmployeeRoleAssigned.v1`
- `EmployeeRoleRemoved.v1`

### Frontend

- Role list/detail/create/edit/archive foundation.
- Employee detail role assignments with effective status and history.

### Tests

- Multiple roles combine active grants without overwriting another assignment.
- Removed, expired, inactive, cross-organization, or archived assignments do not authorize.
- Duplicate active assignments are prevented/idempotent as designed.
- Founder/job-title values have no implicit effect.
- Assignment/removal authorization, audit, and concurrency tests.

### Observability

- Safe counts/outcomes for role and assignment mutations.
- High-risk alerts/hooks for unexpected bulk assignment changes without high-cardinality labels.

### Security considerations

- Role assignment is authorization-sensitive and passes the fail-closed typed T05 authorization port; S02-T07 will replace this seam with the central authorization decision.
- S02-T09 owns approval policy. T05 does not turn the missing future policy implementation into an allow-all shortcut or invent approval rules.
- Prevent an actor from bypassing permission-management controls by creating or editing a role.

### Acceptance criteria

- [x] Roles are organization-scoped and customizable.
- [x] Employees can hold multiple effective roles and T05 exposes all of them through the stable effective-role query contract; S02-T06/T07 remain responsible for grants and final authorization evaluation.
- [x] Role assignment/removal history records issuer and effective/removed times.
- [x] No job title, employee name, email, or Founder flag grants authority.
- [x] Role APIs, OpenAPI, UI, audit/events, and allow/deny/multi-role tests are complete.

### Acceptance evidence — 2026-09-02

- Added the organization-scoped `Role` and historical `EmployeeRole` entities in the single additive migration `20260902230000_sprint_02_t05_role_model`. A fresh five-migration database and a canonical-main-to-T05 upgrade with Organization, Employee, UserAccount, SSOIdentity, Invitation, AuditEvent, and SecurityEvent sentinels passed with zero drift and no destructive change.
- Role keys are trimmed/lowercased and immutable after creation; names are trim/whitespace/lowercase normalized. Organization-local key and normalized-name uniqueness, cross-organization reuse, bounded inputs, control-character rejection, and explicit archive behavior are covered in API/PostgreSQL tests.
- `EmployeeRole` preserves assigner/effective/expiry/removal/remover history. Direct injected-clock evaluation makes an assignment ineffective at exactly `now == expires_at`; expired and removed rows remain and permit a new historical assignment.
- PostgreSQL locking uses Role → Employee → matching EmployeeRole order. Concurrent duplicate assignment creates at most one new effective row; different-role assignment preserves both roles; remove-versus-assign and archive-versus-assign end safely without an archived effective assignment.
- Exact duplicate assignment and repeated removal/archive return idempotently without duplicate T12 audit or outbox history. Different expiry semantics return a stable conflict.
- Role create/update/archive and employee-role assign/remove each commit mutation + required AuditEvent + versioned outbox event atomically. Forced audit and outbox failures prove rollback without false-success history.
- All six authorized APIs and `/admin/roles` are documented/implemented. The UI covers create/edit/archive, multi-role assignment/removal results, expiry/removal state, and loading/empty/unauthorized/forbidden/conflict/validation/error states.
- Default production role APIs fail closed without a trusted actor. Test adapters fail registration outside `APP_ENV=test`. Founder, Super Admin, Developer/job-title-like names, email/header/query assertions, and frontend state grant no authority.
- `npm run quality:gate` passed with 140 unit/API/frontend tests and 83 PostgreSQL integration tests, plus lint, Prisma validation/status/zero-drift checks, typecheck, production build, and Docker Compose validation.
- Fresh Docker rebuild/runtime validation passed: migration exited 0; PostgreSQL, API, web, and worker reported healthy; health, web, role UI, and OpenAPI returned HTTP 200; all six protected T05 routes returned HTTP 401 without a trusted actor.
- No Session, Permission/RolePermission persistence, central authorization engine, approval/access/offboarding/bootstrap behavior, privileged role seed, customer account, or public signup was added. S02-T04, S02-T06+, and S02-T13+ remain unauthorized.

### Do Not Change

- Do not create one immutable Super Admin role, a Founder override, one-role-per-employee behavior, or destructive deletion of assignment history.

---

## S02-T06 — Permission Registry

### Objective

Create the stable permission-key registry and organization-scoped role-to-permission grants needed by Sprint 02 and extensible for future modules.

### Dependencies

- S02-T05.

### Schema scope

- `Permission`: stable product-global key, domain/resource/action metadata, description, risk classification, active/deprecated metadata, and version/audit timestamps as needed.
- `RolePermission`: organization-consistent role, permission, scope type/binding, grant/revoke metadata, issuer, and history.
- Registry synchronization is additive/safe; removal or renaming requires explicit compatibility handling.

### API scope

- `GET /api/v1/permissions`
- `GET /api/v1/roles/:id/permissions`
- `POST /api/v1/roles/:id/permissions`
- `POST /api/v1/roles/:roleId/permissions/:permissionKey/remove`
- Permission definition mutation is restricted to controlled registry/deployment mechanisms unless a later approved design says otherwise.

### Permission scope

- `admin.permission.read`
- `admin.permission.manage`
- Only the registry keys listed in this specification are introduced in Sprint 02.

### Events

- `PermissionRegistered.v1`
- `RolePermissionGranted.v1`
- `RolePermissionRemoved.v1`
- `PermissionDeprecated.v1` if deprecation is implemented.

### Frontend

- Readable permission catalog grouped by domain/resource.
- Role permission assignment UI with scope and risk visibility.

### Tests

- Key-format validation and uniqueness.
- Unknown/deprecated permission denial.
- Grant/removal, multi-role union, expiry where applicable, and cross-organization denial.
- `update` does not imply `delete`; unknown future permissions deny.
- Registry synchronization does not silently drop active contracts.

### Observability

- Registry drift/startup validation and controlled mutation outcomes.
- Critical security events for permission-sensitive administration.

### Security considerations

- Permission-management is critical-risk and must invoke approval/step-up policy hooks once available.
- Prevent arbitrary permission strings from becoming grants.

### Acceptance criteria

- [x] Every Sprint 02 permission follows `<domain>.<resource>.<action>` and is registered once.
- [x] Role grants reference registry entries and are organization-scoped.
- [x] Unknown, malformed, inactive, or removed permission grants never authorize.
- [x] No future business-module permission catalog is prematurely added.
- [x] Permission APIs, OpenAPI, UI, registry documentation, audit/events, and allow/deny tests are complete.

### Do Not Change

- Do not infer permissions from routes, frontend visibility, role names, job titles, or arbitrary database strings; do not implement every future module's permissions.

---

## S02-T07 — Central Authorization Service

**Status: AUTHORIZED — IMPLEMENTATION UNDER REVIEW.**

### Objective

Implement one server-side authorization service through the canonical `authorize(actor, action, resource, context)` contract and integrate it with all Sprint 02 protected use cases.

### Dependencies

- S02-T01, S02-T04, S02-T05, and S02-T06.
- S02-T08 extends the service through the scope-resolver contract after this core is available.

### Schema scope

- No standalone authorization-decision table is required.
- Consume identity, session, role, and permission records through bounded repository/query interfaces.
- Define extension ports for scope, temporary-access, emergency-access, and policy evaluators; their owning tickets provide the implementations.

### API scope

- No public "can I" endpoint is required.
- NestJS guards/interceptors may adapt HTTP requests, but application use cases must also invoke the canonical service where actions can originate outside HTTP.
- Return stable safe denial/error codes through the existing error envelope.

### Permission scope

- Enforces all registered permissions; grants no implicit wildcard.
- Future Web, worker, AI, and MCP adapters must call the same application authorization boundary.

### Events

- Sensitive allowed/denied decisions may create security events according to policy.
- Authorization checks must not emit an outbox event for every routine read.

### Frontend

- Expose permission-aware view-model/capability data only as a UX convenience.
- Hidden buttons/routes never substitute for API/application authorization.

### Tests

- Allow and deny, missing permission, removed role, multiple roles, invalid session/account lifecycle, wrong organization, base `SELF`/`ORGANIZATION` behavior, and fail-closed missing extension resolvers.
- Direct use-case invocation cannot bypass authorization by skipping an HTTP guard.
- Stable denial codes reveal no sensitive target existence across scopes.

### Observability

- Bounded metrics by action family, allow/deny, and safe reason code.
- Sampling/rate controls prevent routine authorization logs from becoming a sensitive data store or availability risk.

### Security considerations

- Deny by default and fail closed on repository, resolver, or policy errors.
- Use server-derived actor, organization, session, and resource context; ignore caller assertions that are not independently verified.
- Cache only with lifecycle/grant invalidation and expiry correctness.

### Acceptance criteria

- [ ] Every Sprint 02 protected use case invokes the canonical authorization service server-side.
- [ ] A valid frontend request cannot bypass authorization by manipulating hidden controls or route payloads.
- [ ] Missing/unknown permissions, extension resolvers, or policy context deny safely.
- [ ] Multi-role evaluation and the extension contracts required by scope, temporary, emergency, and approval tickets are stable and testable.
- [ ] Web/API behavior and future non-HTTP callers share the same contract.
- [ ] Unit, application, API, and PostgreSQL allow/deny tests pass.

### Do Not Change

- Do not scatter role-name checks, query the database directly from AI/MCP/integration adapters, create a universal bypass, or treat frontend state as authority.

---

## S02-T08 — Resource & Scope Authorization Foundation

### Objective

Support the approved scope model through extensible, fail-closed resource resolvers without creating business modules that do not yet exist.

### Dependencies

- S02-T06 and S02-T07 authorization contracts.

### Schema scope

- `ScopeType` values: `SELF`, `ASSIGNED`, `TEAM`, `DEPARTMENT`, `PROJECT`, `CUSTOMER`, `ORGANIZATION`, `EXPLICIT`.
- Scope binding fields/tables carry `organization_id`, permission/grant reference, resource type, and resource ID where applicable.
- No Sprint 02 Project, Customer, Team, or Department business entity/table.

### API scope

- Scope selection/inspection is part of role-permission and temporary/emergency grant APIs.
- No generic endpoint accepts an unvalidated arbitrary scope claim as authorization proof.

### Permission scope

- Scope narrows a registered permission; it never creates a permission.
- Scope administration uses the permission/grant-management permissions owned by S02-T06, S02-T10, and S02-T11.

### Events

- Scope grant changes are included in role-permission/access-grant events and audit snapshots.
- No Project/Customer domain event is introduced.

### Frontend

- Reusable scope selector/display for role and access administration.
- Future/unavailable resource types show a safe unsupported state rather than fabricated records.

### Tests

- Positive and negative tests for all eight scope types using real identity data or typed resolver fakes.
- Wrong organization, missing resolver, unassigned actor, wrong team/department/project/customer, and malformed explicit resource denial.
- Scope union across multiple roles never broadens beyond the union of valid active grants.

### Observability

- Safe denial reason metrics for missing resolver, relationship mismatch, and organization mismatch.
- Resolver latency/error measurement without resource identifiers as labels.

### Security considerations

- Resolver interfaces receive trusted organization and actor context and verify typed resource relationships.
- Project/Customer opaque IDs cannot authorize until the owning resolver confirms organization and relationship.

### Acceptance criteria

- [ ] All approved scope types exist as stable contracts.
- [ ] `SELF`, `ORGANIZATION`, and identity `EXPLICIT` work against Sprint 02 data.
- [ ] Other scopes are proven through contract tests and deny when no owning resolver is installed.
- [ ] Scope bindings cannot cross organizations or reference an unregistered permission.
- [ ] No fake Project, Customer, Team, Department module/table/API/UI is created.
- [ ] Scope APIs/components, audit, documentation, and test matrix are complete.

### Do Not Change

- Do not silently map unsupported scopes to `ORGANIZATION`, trust client-supplied membership, or prebuild future business modules.

---

## S02-T09 — Approval Engine Foundation

### Objective

Provide generic approval requests, ordered/parallel steps, approver resolution, approve/reject decisions, execution state, and immutable history for identity/security actions.

### Dependencies

- S02-T01, S02-T07, S02-T08, and S02-T12 audit foundation.

### Schema scope

- `ApprovalRequest`: `organization_id`, requester and actor snapshots, action/resource/context snapshot, risk, policy outcome, status, reason, correlation/idempotency data, and execution state/result references.
- `ApprovalStep`: request relation, sequence/group, resolved approver subject, status, decision/reason/timestamps, and concurrency version.
- Append-only decision/execution history sufficient to reconstruct request, steps, approvals, rejection, execution success, and execution failure.
- Lifecycle aligns with `DRAFT → PENDING → IN_REVIEW → APPROVED/REJECTED → EXECUTED/FAILED` where applicable.

### API scope

- `GET /api/v1/approvals`
- `GET /api/v1/approvals/:id`
- `POST /api/v1/approvals/:id/approve`
- `POST /api/v1/approvals/:id/reject`
- Request creation/execution occurs through the sensitive owning command, not a client-authored arbitrary action payload.

### Permission scope

- `approval.request.read`
- `approval.request.approve`
- `approval.request.reject`
- Approver resolution also checks scope, current lifecycle, and policy; permission alone does not make a user the resolved approver.

### Events

- `ApprovalRequested.v1`
- `ApprovalStepApproved.v1`
- `ApprovalRejected.v1`
- `ApprovalCompleted.v1`
- `ApprovedActionExecuted.v1`
- `ApprovedActionExecutionFailed.v1`

### Frontend

- Approval inbox foundation, filters, request detail, steps/history, reason, risk, target context, and approve/reject actions.
- Clear distinction between approved and successfully executed.

### Tests

- All six policy outcomes: no approval, single, sequential, parallel, step-up only, step-up plus approval.
- Wrong approver, wrong order/group, duplicate/concurrent decision, rejection, execution success/failure, stale request/resource context, and cross-organization denial.
- Approver resolution contract tests without hard-coded founder/job-title logic.
- Audit/event completeness and idempotent execution.

### Observability

- Pending age, decision outcome, execution failure, and policy-resolution error metrics.
- Correlated logs distinguish policy, decision, and execution without leaking sensitive payload snapshots.

### Security considerations

- Store server-created canonical action/resource snapshots; never execute arbitrary client-supplied commands after approval.
- Reauthorize and revalidate relevant state at execution time.
- Exact self-approval/separation-of-duty and production approver bindings remain policy configuration requiring supervisor approval; do not invent them.

### Acceptance criteria

- [ ] The engine supports every required policy outcome and step topology.
- [ ] Only a currently resolved, authorized approver can decide a pending step.
- [ ] Sequential/parallel decisions are concurrency-safe and fully reconstructable.
- [ ] Approval does not imply execution; execution state/failure is separately recorded.
- [ ] Approved execution revalidates authorization/policy/resource context and is idempotent.
- [ ] No financial, licensing, warranty, or other out-of-scope threshold is implemented.
- [ ] APIs, OpenAPI, UI, events, audit, and unit/integration/workflow tests are complete.

### Do Not Change

- Do not hard-code approvers, founder overrides, business thresholds, automatic execution bypasses, or mutable/deletable approval history.

---

## S02-T10 — Temporary / Delegated Access

### Objective

Support explicit, reasoned, issuer-attributed, time-bounded, revocable delegated access with complete history and automatic authorization expiry.

### Dependencies

- S02-T07, S02-T08, S02-T09, and S02-T12.

### Schema scope

- `TemporaryAccessGrant`: `organization_id`, issuer, recipient, reason, start/expiry/revocation data, status, approval reference, and audit timestamps.
- Child bindings for explicit registered permissions and scopes/resources.
- Preserve issuer/recipient/permission/scope snapshots after expiry/revocation.

### API scope

- `GET /api/v1/temporary-access`
- `POST /api/v1/employees/:id/temporary-access`
- `GET /api/v1/temporary-access/:id`
- `POST /api/v1/temporary-access/:id/revoke`

### Permission scope

- `admin.access.temporary`
- `admin.access.revoke`
- Issuers cannot grant permissions/scopes they are not authorized to delegate under policy.

### Events

- `TemporaryAccessRequested.v1`
- `TemporaryAccessGranted.v1`
- `TemporaryAccessRevoked.v1`
- `TemporaryAccessExpired.v1`; authorization expiry remains direct time evaluation.

### Frontend

- Create/view/revoke temporary grants with explicit permission, scope, reason, issuer, recipient, start, expiry, status, approval, and history.

### Tests

- Before-start, active, exactly-at-expiry, expired, revoked, wrong-scope, wrong-organization, inactive recipient, and removed permission behavior using an injected clock.
- Delegation-boundary and approval-required tests.
- Repeated revoke and concurrent expiry/revoke safety.
- Audit/event completeness.

### Observability

- Active/expiring/expired/revoked counts and anomalous grant-creation failures.
- No recipient/issuer/resource identifiers in metric labels.

### Security considerations

- Expiry is mandatory and enforced on each authorization decision.
- Grant creation is least-privilege, explicit, approval-aware, and unable to create arbitrary permission keys.

### Acceptance criteria

- [ ] Every grant has explicit permissions/scopes, reason, issuer, recipient, start, and expiry.
- [ ] A grant cannot authorize before start, at/after expiry, after revocation, or outside its organization/scope.
- [ ] Authorization does not depend on an expiry worker/event.
- [ ] Grant, approval, revocation, and historical details remain auditable.
- [ ] Delegation cannot exceed the issuer/policy boundary.
- [ ] APIs, OpenAPI, UI, events, and deterministic expiry/integration tests are complete.

### Do Not Change

- Do not create permanent temporary access, wildcard grants, silent renewal, unreasoned delegation, or cleanup-dependent expiry.

---

## S02-T11 — Emergency Access Foundation

### Objective

Provide an explicit, time-limited, reason-required, risk-classified, step-up and policy-controlled emergency-access path that still uses central authorization and complete audit history.

### Dependencies

- S02-T04, S02-T07, S02-T08, S02-T09, S02-T10 patterns, and S02-T12.

### Schema scope

- `EmergencyAccessGrant`: `organization_id`, requester/recipient, reason, risk classification, requested/approved/active time window, step-up evidence reference/time, approval/policy reference, explicit permission/scope bindings, revocation/expiry data, and immutable history references.
- Risk uses the approved `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` vocabulary; production eligibility/policy is configurable.

### API scope

- `POST /api/v1/emergency-access/requests`
- `GET /api/v1/emergency-access`
- `GET /api/v1/emergency-access/:id`
- `POST /api/v1/emergency-access/:id/activate` after policy/step-up satisfaction.
- `POST /api/v1/emergency-access/:id/revoke`

### Permission scope

- `admin.access.emergency`
- `admin.access.revoke`
- Normal target action permission is still evaluated with the emergency grant through the central service.

### Events

- `EmergencyAccessRequested.v1`
- `EmergencyAccessActivated.v1`
- `EmergencyAccessDenied.v1`
- `EmergencyAccessUsed.v1` for material actions.
- `EmergencyAccessRevoked.v1`
- `EmergencyAccessExpired.v1`

### Frontend

- Emergency request form with prominent reason/risk/duration, step-up state, approval state, active countdown, explicit scope, usage/history, and revoke action.
- No hidden or one-click universal bypass.

### Tests

- Missing reason/duration/risk, stale or failed step-up, approval-required, wrong approver, before-start, expiry boundary, revocation, wrong scope, and organization mismatch.
- Emergency access still denies an unrelated action/resource.
- Material use creates audit/security history and expired access stops without cleanup.

### Observability

- High-priority security events and alert hooks for request, activation, use, denial, revocation, and expiry.
- Metrics are bounded and exclude reasons/identifiers.

### Security considerations

- Step-up verification is a provider-neutral interface and freshness is policy-controlled.
- Duration is explicit and capped by approved configuration; the grant cannot become standing access.
- Emergency access augments a narrowly explicit decision; it never disables central authorization.

### Acceptance criteria

- [ ] Reason, duration, risk, step-up outcome, policy/approval outcome, issuer/recipient, permission/scope, and history are mandatory and traceable.
- [ ] Emergency access authorizes only explicit active grants through the central authorization service.
- [ ] Expiry and revocation take effect immediately without a worker dependency.
- [ ] Material use produces complete audit and high-priority security events.
- [ ] No emergency path can create an unrestricted Super Admin or cross-organization bypass.
- [ ] APIs, OpenAPI, UI, alerts/hooks, and policy/security tests are complete.

### Do Not Change

- Do not bypass authorization, skip reason/step-up/policy hooks, allow indefinite duration, hide usage, or create a break-glass database credential.

---

## S02-T12 — Security Events & Audit

### Objective

Provide tamper-resistant application audit history and security-focused event records for all required Sprint 02 identity/access actions while preserving historical actor and context information.

### Dependencies

- S02-T01 identity references.
- Each owning ticket integrates its mutation/security outcomes before Sprint 02 closes.

### Schema scope

- `AuditEvent`: `organization_id`, stable event/action key, actor ID when retained, actor display/identity snapshot, target type/ID and snapshot, request/correlation/session context, reason, old/new state or structured safe delta, approval reference, occurred timestamp, and integrity/version metadata.
- `SecurityEvent`: `organization_id` where resolved, category/type, severity/risk, outcome, actor/account/session/provider references and safe snapshots where available, request/correlation data, network/device metadata subject to minimization, occurred timestamp, and investigation metadata if authorized.
- Append-oriented records; actor/account deletion or change cannot erase historical meaning.

### API scope

- `GET /api/v1/audit-events`
- `GET /api/v1/audit-events/:id`
- `GET /api/v1/security-events`
- `GET /api/v1/security-events/:id`
- Filtered/paginated reads only; no general update/delete endpoint.

### Permission scope

- `audit.event.read`
- `security.event.read`
- Sensitive fields are serialized by permission/scope and minimization policy.

### Events

- Cover at minimum successful login, failed login where provider data is safely available, session revoke, account suspension, invitation lifecycle, role assignment/removal, permission-sensitive administration, temporary access, emergency access, offboarding, and approval decisions/execution.
- Audit persistence may be transactional with the mutation; external notification/alert side effects use the outbox.

### Frontend

- Authorized audit/security event lists and details only to the minimum required for Sprint 02 administration.
- Safe redaction and empty/permission/error states.

### Tests

- Required event coverage for every owning ticket.
- Historical actor/context survives display-name/account/lifecycle changes.
- Cross-organization read denial and sensitive-field redaction.
- Transaction rollback does not leave a false success audit; successful critical mutation cannot commit without required audit.
- Secrets/tokens/codes/reasons classified as secret never persist or log.

### Observability

- Audit-write/security-event-write failure metrics and alerts for critical pipelines.
- Event volume/severity/outcome metrics with bounded labels.
- Operational logs reference event IDs rather than duplicating sensitive payloads.

### Security considerations

- Restrict writes to internal application services and make history append-oriented.
- Apply data minimization and documented retention/access rules without erasing required historical accountability.
- Failed-login records must avoid account enumeration and store provider information only when safely available.

### Acceptance criteria

- [x] Every currently authorized T01/T03 security/audit event is captured with request/correlation and historical actor/context.
- [x] Critical mutations and their audit record are transactionally consistent where required.
- [x] History cannot be generally edited or hard-deleted through the API.
- [x] Cross-organization and unauthorized reads deny; sensitive fields are minimized/redacted.
- [x] No plaintext secret, invitation/session token, SSO code/token, or credential is stored.
- [x] APIs, OpenAPI, the explicitly deferred T14-dependent UI boundary, event documentation, tests, and failure observability are complete.

### Acceptance evidence — 2026-09-02

- Added the organization-scoped `AuditEvent` and nullable-pre-identity `SecurityEvent` entities in the single additive migration `20260902120000_sprint_02_t12_audit_security_events`; database triggers reject event row update/delete and all retained actor/account foreign keys use `RESTRICT`.
- T01 self/admin profile writes and required audit appends now commit in one Prisma transaction. PostgreSQL tests prove successful joint commit, audit-failure mutation rollback, and mutation-failure audit rollback.
- T03 `AuthenticationSucceeded.v1` and `AuthenticationFailed.v1` hooks now persist minimized security records. Replay/failure responses remain the same non-enumerating public contract; state, nonce, code, email, provider subject, login hint, tokens, and raw provider data are absent from event persistence and logs.
- All four GET-only audit/security endpoints are documented in OpenAPI with validated explicit filters, maximum page size 100, safe views, trusted organization scope, and `audit.event.read` / `security.event.read` fail-closed authorization ports. Cross-organization detail reads return the same `NOT_FOUND` response as absent IDs.
- The current structured metrics adapter records bounded audit/security write success/failure and safe category/outcome/risk volume; critical persistence failure logs contain bounded classifications only and successful logs reference the event ID.
- Fresh migration, canonical-main-to-T12 upgrade, migration status, Prisma validation, and drift checks passed with no destructive change. `npm run quality:gate` passed with 102 unit tests and 27 PostgreSQL integration tests, plus lint, typecheck, build, and Docker Compose validation.
- Docker runtime validation passed: migration exited 0; PostgreSQL, API, web, and worker reported healthy; direct web/API probes returned HTTP 200 and the worker heartbeat check passed.
- No T12 screen was added because the current web shell has no authorized application-session or central authorization capability; implementing a trustworthy administration route would prematurely enter S02-T04/T07/T14. This boundary is documented in `docs/engineering/SPRINT_02_T12_AUDIT_SECURITY_EVENTS.md` under the supervisor's explicit frontend deferral rule.
- Retention policy and cryptographic chaining remain deliberately unimplemented; no cleanup/export API, mutable correction mechanism, or fake future-workflow event was introduced.

### Do Not Change

- Do not make mutable operational logs the audit source of truth, cascade-delete historical actor context, or expose unrestricted audit/security-event exports.

---

## S02-T13 — Offboarding

### Objective

Implement the approved `Active/Suspended → Offboarding → Archived` access-lifecycle commands so departed employees cannot authenticate or retain active access while history and ownership references remain intact.

### Dependencies

- S02-T01, S02-T04, S02-T05, S02-T07, S02-T09, S02-T10, S02-T11, and S02-T12.

### Schema scope

- Reuse employee/account lifecycle fields and add offboarding command metadata: initiated/completed timestamps, actor, reason, approval reference, and safe progress/result data as needed.
- Revoke/end active `EmployeeRole`, `Session`, `TemporaryAccessGrant`, and `EmergencyAccessGrant` records without deleting history.
- Preserve future ownership foreign keys to the archived employee; ownership transfer is a future owning-module workflow.

### API scope

- `POST /api/v1/employees/:id/suspend`
- `POST /api/v1/employees/:id/offboard`
- `POST /api/v1/employees/:id/archive` or an internal completion command after offboarding gates succeed.
- No generic employee status patch and no employee delete endpoint.

### Permission scope

- `admin.employee.suspend`
- `admin.employee.offboard`
- Approval/step-up outcome is resolved through policy; exact production approver bindings are not hard-coded.

### Events

- `EmployeeSuspended.v1`
- `EmployeeOffboardingStarted.v1`
- `EmployeeAccessRevoked.v1`
- `EmployeeOffboarded.v1`
- `EmployeeArchived.v1`

### Frontend

- Employee detail suspension/offboarding commands with reason, impact summary, approval state, progress/result, and preserved history.
- Explicit confirmation; no bulk destructive offboarding in Sprint 02.

### Tests

- Prevent new authentication immediately on suspension/offboarding.
- Revoke all sessions, role assignments, temporary access, and emergency access.
- Idempotent retry/concurrency and partial-side-effect rollback/recovery behavior.
- Invalid transitions, unauthorized actor, approval-required/rejected path, self-target policy as configured, and cross-organization denial.
- Historical audit/ownership references remain queryable; no cascade delete.

### Observability

- High-priority start/success/failure events and incomplete-offboarding alerting.
- Correlation across employee transition and every access revocation.

### Security considerations

- Account-state checks deny immediately even if downstream cleanup/revocation is retried.
- Use one controlled application transaction where possible and reliable outbox processing for non-authoritative side effects.
- Never erase historical authorship/ownership to make access removal easier.

### Acceptance criteria

- [ ] Suspension/offboarding prevents new authentication and continued session authorization immediately.
- [ ] All active roles and temporary/emergency grants stop authorizing and retain revocation history.
- [ ] The employee reaches only approved lifecycle states through explicit commands.
- [ ] Offboarding is approval/policy-aware, idempotent, observable, and fully audited.
- [ ] Historical ownership, actor, approval, and audit references remain valid after archive.
- [ ] No normal workflow permanently deletes an employee/account.
- [ ] APIs, OpenAPI, UI, events, and end-to-end PostgreSQL tests are complete.

### Do Not Change

- Do not delete employees, reassign future business ownership without its owning module/policy, allow authentication during offboarding, or silently reactivate archived users.

---

## S02-T14 — Identity / Security Frontend Foundation

### Objective

Implement only the internal UI required to operate Sprint 02 identity/security capabilities, while keeping backend authorization authoritative.

### Dependencies

- Accepted backend contracts for S02-T01 through S02-T13.

### Schema scope

- None beyond the owning backend tickets.

### API scope

- Consume documented `/api/v1` identity, session, employee, role, permission, invitation, approval, temporary/emergency access, audit, and security-event APIs.
- No frontend-only data mutation or direct database access.

### Permission scope

- Navigation, pages, fields, and actions reflect authenticated capabilities.
- Every API call is still server-authorized; UI capability state is advisory.

### Events

- No separate business events from rendering.
- User commands emit events through their owning backend use cases only.

### Frontend

- Sign-in entry and safe auth errors.
- Invitation onboarding.
- Account/session page.
- Employee list and employee detail.
- Roles and permissions administration.
- Invitation management.
- Approval inbox foundation.
- Authorized security/session administration, including temporary/emergency access and security/audit history where required.
- Responsive empty, loading, validation, error, expired, revoked, and permission-denied states.

### Tests

- Component and route tests for authenticated/unauthenticated and allowed/denied states.
- Critical flows: sign-in/onboarding, revoke session, invite/revoke, role assignment, approval decision, temporary/emergency access, suspend/offboard.
- Accessibility baseline: keyboard operation, focus management, labels, error association, contrast, and status announcements.
- No hidden-action test is treated as proof of authorization; API denial remains covered in backend tests.

### Observability

- Safe client error reporting correlated with server request IDs.
- No tokens, invitation secrets, SSO callback parameters, reasons containing sensitive data, or employee PII in analytics/logging.

### Security considerations

- Prevent secret leakage through URL persistence, browser storage, error telemetry, and referrers.
- Apply CSRF/XSS/content-security protections consistent with the chosen session model.
- Internal-only routes still require authentication and authorization.

### Acceptance criteria

- [ ] Every listed Sprint 02 flow has a usable internal UI and all out-of-scope modules remain absent.
- [ ] Unauthorized navigation/actions are hidden or disabled for UX and independently denied by the server.
- [ ] Authentication, onboarding, session, approval, access, and offboarding states are clear and accessible.
- [ ] No customer/public signup path or production local-login bypass exists.
- [ ] Client telemetry and storage contain no raw secrets/tokens.
- [ ] Frontend unit/component/flow tests, typecheck, build, and responsive/accessibility review pass.

### Do Not Change

- Do not build CRM or other business navigation, customer-facing UI, a frontend authorization engine, or a broad design-system/marketing-site rewrite.

---

## S02-T15 — Quality, API & Documentation Gate

### Objective

Prove Sprint 02 behavior, security, migrations, APIs, frontend, Docker runtime, and CI are complete and documented before requesting sprint closure.

### Dependencies

- S02-T00 through S02-T14 completed and individually accepted.

### Schema scope

- Validate all authorized Sprint 02 migrations from a fresh database and from the closed Sprint 01 schema.
- Verify constraints, indexes, organization scoping, timestamps, restrictive historical relations, and rollback/recovery documentation.
- This planning ticket does not itself authorize a migration.

### API scope

- Validate every Sprint 02 route, command, DTO, response/error code, pagination/filter contract, request ID, and OpenAPI operation/schema.
- Confirm no public signup, customer-account, employee-delete, or generic lifecycle-status bypass endpoint exists.

### Permission scope

- Reconcile implemented keys against the Sprint 02 registry.
- Prove every protected route and use case has server-side authorization and correct scope/policy behavior.

### Events

- Reconcile event names/versions/payload documentation and transactional audit/outbox behavior.
- Verify no event payload contains plaintext secrets or unnecessary sensitive identity data.

### Frontend

- Complete route/permission/error/accessibility/responsive review and capture screenshots where practical for the pull request.
- Confirm only Sprint 02 internal UI is present.

### Tests

- Database migration tests.
- Unit tests.
- PostgreSQL integration tests.
- Authentication and authorization allow/deny tests.
- Multiple-role and all-scope tests.
- Session revoke and expiry tests.
- Invitation expiry/revocation/replay/concurrency tests.
- Approval outcome/step/execution tests.
- Temporary-access start/expiry/revocation tests.
- Emergency-access reason/duration/risk/step-up/approval/use tests.
- Offboarding and audit/security-event tests.
- API/OpenAPI/error/request-ID tests and frontend flow/accessibility tests.
- Regression tests for queue/outbox semantics, including deterministic timestamp tests from S02-T00.

### Observability

- Verify dashboards/queries or documented operational checks for authentication failures, session revocation, security events, audit write failures, pending/failed approvals, active/expiring privileged grants, and incomplete offboarding.
- Validate bounded metrics, safe logs, request/correlation propagation, and alert hooks without secrets/PII labels.

### Security considerations

- Perform targeted secret/token leakage review, dependency audit, authorization bypass review, organization-isolation review, secure-session/CSRF review, rate-limit review, and production local-adapter fail-closed validation.
- Bootstrap policy is supervisor-approved, but implementation remains unauthorized until its owning ticket is explicitly authorized.

### Acceptance criteria

- [ ] Every ticket acceptance checklist is satisfied with evidence.
- [ ] Fresh and Sprint-01-to-Sprint-02 migration validation passes without destructive historical behavior.
- [ ] Unit, PostgreSQL integration, API/contract, authorization, scope, session, invitation, access, approval, offboarding, audit/security-event, and frontend tests pass.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, and `npm run build` pass.
- [ ] `npm run quality:gate` and the GitHub Actions quality gate pass.
- [ ] Docker configuration and the API/Web/Worker/PostgreSQL/migration runtime validation pass.
- [ ] OpenAPI, permission/event catalogs, environment docs, migration notes, security operations, and relevant ADRs are current.
- [ ] No plaintext secrets/tokens, public signup, customer account, Founder override, direct-DB authorization shortcut, or out-of-scope module exists.
- [ ] Supervisor review of permission, approval, bootstrap, security architecture, and migrations is recorded before Sprint 02 closure.

### Do Not Change

- Do not waive failing gates, mark Sprint 02 complete with missing security evidence, broaden scope to later modules, or start Sprint 03 without explicit supervisor approval.

---

## Sprint 02 completion gate

Sprint 02 may be presented for supervisor closure only after all ticket gates pass and the implementation has been explicitly reviewed. Approval of this planning document alone does not satisfy that gate.

The final implementation report must use the repository completion format and include:

- tickets completed and any approved deviations;
- schema and migration inventory;
- APIs/OpenAPI and frontend routes;
- permission, scope, approval, and event catalogs;
- security/observability behavior;
- tests and exact commands/results;
- Docker and GitHub Actions evidence;
- documentation/ADR updates;
- remaining risks/technical debt; and
- every supervisor decision requested or recorded.

## Sprint-level Do Not Change

- Keep Dar Tech OS internal-only; no customer portal or public signup.
- Keep employee lifecycle `Invited → Active → Suspended → Offboarding → Archived`.
- Keep roles customizable and support multiple roles per employee.
- Keep authorization server-side and centralized; Web, API, future AI, and future MCP use the same boundary.
- Keep `delete` separate from normal update permissions and preserve historical records.
- Keep temporary/emergency access explicit, expiring, revocable, reasoned, policy-aware, and audited.
- Keep queue/outbox semantics unchanged by S02-T00.
- Keep production identity-provider choice deferred and provider-specific code behind adapters.
- Keep the approved bootstrap administrator policy unimplemented until its owning ticket is explicitly authorized.
- Do not add plaintext secrets/tokens, direct database authorization shortcuts, fake business modules, or hard-coded Founder/Super Admin behavior.
- Do not implement an unauthorized Sprint 02 ticket from this document, and do not start the next sprint without explicit supervisor approval.
