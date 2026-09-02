# Sprint 02 T02 Invitation and Onboarding

## Status and scope

S02-T02 implements the authorized internal invitation-only path from an administrator-issued invitation to an active employee/account linked to a verified provider identity. It integrates the completed T01 identity model, T03 provider-neutral authentication contract, T12 durable event history, and the Sprint 01 transactional outbox.

It creates no application session, cookie, bearer token, refresh token, password flow, customer identity, public signup, production identity-provider adapter, role/permission engine, approval workflow, or bootstrap administrator. S02-T04 and all other unauthorized Sprint 02 tickets remain deferred.

## Invitation lifecycle and schema

Migration `20260902190000_sprint_02_t02_invitation_onboarding` adds `InvitationStatus` and the organization-owned `Invitation` entity. The lifecycle is:

```text
PENDING → ACCEPTED
PENDING → REVOKED
PENDING → EXPIRED
PENDING → SUPERSEDED
```

The database stores the organization, employee/account target, normalized invited email, unique token digest, issuer, issue/expiry times, acceptance/revocation/supersession/completion metadata, and audit timestamps. Multiple historical invitations may reference the same Employee and UserAccount. The old organization/employee and organization/account lifetime-unique indexes are replaced with non-unique historical lookup indexes. A composite self-reference records `superseded_by_invitation_id`, while all employee, account, issuer, revoker, and supersession relations use `ON DELETE RESTRICT`. Database checks enforce normalized email, SHA-256 digest format, issue-before-expiry, terminal-state metadata consistency, and complete non-self supersession metadata.

`SUPERSEDED` is terminal. It records that an authorized resend created a different invitation row and permanently invalidated the prior secret. A terminal invitation is never restored to `PENDING`.

`EXPIRED` is materialized for deterministic reporting and a single observable `InvitationExpired.v1` emission. It is not the authorization mechanism. Every inspect, authentication-start, revoke, and acceptance decision checks the time directly. The exact boundary is:

```text
current_time < expires_at  → eligible
current_time >= expires_at → denied
```

Inspection materializes the matched expired invitation opportunistically, and organization-scoped list processing materializes a bounded batch. Both paths are idempotent and use a row lock plus conditional update. A materialization/audit failure never turns an expired invitation into an allowed invitation.

## Token generation, hashing, and one-time delivery

Invitation secrets use Node's cryptographically secure random generator with 32 random bytes (256 bits), encoded as 43-character base64url. Only the lowercase 64-character SHA-256 digest is stored and uniquely indexed. The raw secret is not stored in an Invitation, authentication transaction, audit/security event, outbox payload, log, metric, analytics field, local storage, or session storage.

Authorized issue, resend, and re-invite responses return their newly generated raw secret exactly once in this form:

```text
/onboarding#invite=<one-time-secret>
```

Each response sets `Cache-Control: no-store`. Every resend and re-invite generates a new 256-bit secret, a different digest, and a new Invitation row; no prior secret or digest is recovered or reused. Invitation list, revoke, and historical records use an explicit serializer without `tokenHash` or `acceptanceUrl`.

The onboarding page reads the fragment, immediately calls `history.replaceState` to remove it from the visible URL, keeps the secret only in React memory until provider authentication starts, and sends it only in an HTTPS POST body. The onboarding route and API set `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. Client analytics and error-telemetry integrations are not installed.

## Configuration

`INVITATION_TTL_SECONDS` is required runtime configuration and has no schema/default fallback. Tests supply an explicit deterministic value. Staging and production therefore cannot silently inherit an unapproved invitation lifetime. The checked-in `.env.example` and Compose fallback contain a local-development example only.

The external onboarding limiter uses:

- `ONBOARDING_RATE_LIMIT_MAX_REQUESTS` (default 30);
- `ONBOARDING_RATE_LIMIT_WINDOW_SECONDS` (default 60).

These are technical defense defaults, not an invitation-lifetime business policy.

## Internal invitation management

The protected commands are:

```text
POST /api/v1/employees/invite
POST /api/v1/employees/:id/reinvite
GET  /api/v1/invitations
POST /api/v1/invitations/:id/revoke
POST /api/v1/invitations/:id/resend
```

They reference typed actions `admin.employee.invite`, `admin.invitation.read`, `admin.invitation.revoke`, and `admin.invitation.resend`. Resend and re-invite both require the explicit resend action. Until S02-T06/T07/T04 install trusted identity and central policy, default actor and authorization adapters deny. Test adapters can be installed only under `APP_ENV=test`; there is no Founder, title, email, header, query, or frontend bypass.

The invite request accepts exactly the five T01 identity/profile fields. Organization scope comes only from the trusted actor. Employee `INVITED`, authentication-ineligible `UserAccount`, `PENDING` invitation, required T12 audit/security history, and `EmployeeInvited.v1` outbox event commit in one transaction.

Revocation is the explicit `PENDING → REVOKED` command. It records revoker, timestamp, and optional explicitly safe reason. The repository locks the organization-scoped invitation row. Repeating a completed revocation returns the existing result and emits no duplicate audit/security/outbox event. Accepted or expired invitations cannot transition to revoked.

### Resend, re-invite, and the one-active-invitation invariant

Resend applies only to a directly time-eligible `PENDING` invitation whose Employee is still `INVITED` and whose UserAccount remains inactive, enabled, and authentication-ineligible. It creates the replacement row and conditionally changes the old row to `SUPERSEDED` in one transaction. An expired invitation is first materialized as `EXPIRED` and must use re-invite semantics; it is never resurrected.

Re-invite applies only to an `INVITED` Employee with an inactive, enabled, authentication-ineligible UserAccount and no usable current `PENDING` invitation. Existing `EXPIRED`, `REVOKED`, and `SUPERSEDED` rows remain unchanged, and the command creates another historical row. Any accepted history, active/suspended/offboarding/archived employee, active/eligible account, disabled account, valid pending invitation, or cross-organization target denies.

The transactional command boundary enforces at most one usable `PENDING` invitation per employee/account without a process-local mutex. Every mutating path first locks the organization-owned Employee and UserAccount rows, then locks invitation history in deterministic newest-first order. Resend, re-invite, accept, revoke, and expiry use the same target-first ordering and conditional state changes. Concurrent resend/resend, re-invite/re-invite, resend/accept, resend/revoke, and resend/expiry therefore serialize to one valid outcome. A concurrent attempt cannot commit a second usable invitation; any failed mandatory audit/security/outbox write rolls back both supersession and replacement.

Initial `/employees/invite` creates a new Employee/UserAccount aggregate. The existing organization/employee-code uniqueness constraint prevents two concurrent initial commands from creating the same employee. Once an employee exists, all later invitation issuance uses the locked resend/re-invite boundary.

## T03 exact-invitation binding refinement

T03's provider-neutral transaction contract now accepts an optional opaque `authorizationReference`. Normal `/auth` starts provide none and retain their prior behavior. T02 performs the following sequence:

1. Hash and validate the presented invitation secret before provider start.
2. Re-read the invitation and require `PENDING` plus direct time eligibility.
3. Put only the invitation UUID authorization reference into the transient T03 transaction.
4. Preserve T03 state, nonce, PKCE, redirect allowlist, expiry, and single-consume replay behavior unchanged.
5. On callback, pass that exact consumed transaction reference to the invitation eligibility adapter.
6. Re-check the same invitation and all identity/account invariants inside the acceptance transaction.

The callback body does not accept an invitation token, so a different invitation cannot be substituted. The raw secret never crosses into T03 transaction storage. The current T03 in-memory transaction-store limitation for multi-instance production deployment remains unchanged and documented.

## Verified identity binding and atomic acceptance

Initial onboarding requires a non-empty provider subject and a present, verified provider email equal to `invited_email_normalized` after normalization. Missing, unverified, or mismatched email denies. Login hints, external groups, titles, display names, and unverified claims are never evidence. T01's globally unique `(provider_key, provider_subject)` constraint remains authoritative; an existing link denies without reassignment.

Acceptance locks the employee/account target and invitation row with PostgreSQL `FOR UPDATE` and re-checks:

- the exact trusted invitation reference;
- `PENDING`, non-revoked, and `now < expires_at`;
- organization consistency;
- Employee still `INVITED` with no activation timestamp;
- UserAccount still ineligible, inactive, and enabled;
- verified email equality; and
- globally unused provider subject.

The transaction then conditionally consumes the invitation, creates the canonical T01 `SSOIdentity`, activates the account, sets `authenticationEligible=true`, transitions Employee `INVITED → ACTIVE`, sets onboarding timestamps, appends T12 history, and persists outbox events. Row locking plus the conditional status/time update makes double acceptance and accept/revoke/expire races single-terminal. Any mandatory failure rolls back every mutation and provisional history/event.

The successful public result is explicit:

```text
status: ONBOARDING_COMPLETED
sessionCreated: false
nextStep: SESSION_ISSUANCE_DEFERRED
```

## Audit, security history, and outbox

T12 typed contracts now cover invitation issue, revoke, accept, expiry, onboarding completion, and failed acceptance attempts. Successful mutations append organization-scoped minimal actor/target snapshots inside the mutation transaction. Failure history stores only bounded failure categories; it excludes token, email, provider subject, protocol state/nonce/code, and raw payloads.

Resend records `InvitationSuperseded.v1` for the old invitation and `InvitationReissued.v1` with operation `RESEND` for the new invitation. Re-invite records `InvitationReissued.v1` with operation `REINVITE`. Audit and security history include the actor, organization, old and new invitation IDs, operation, safe outcome, and timestamp. None contains an invited email, token, digest, or acceptance URL.

The transactional outbox contracts are:

- `EmployeeInvited.v1` / `identity.employee-invited`;
- `InvitationAccepted.v1` / `identity.invitation-accepted`;
- `InvitationRevoked.v1` / `identity.invitation-revoked`;
- `InvitationExpired.v1` / `identity.invitation-expired`;
- `InvitationSuperseded.v1` / `identity.invitation-superseded`;
- `InvitationReissued.v1` / `identity.invitation-reissued`;
- `OnboardingCompleted.v1` / `identity.onboarding-completed`; and
- canonical T01 `SSOIdentityLinked.v1` / `identity.sso-identity-linked`.

Payloads contain only stable organization/invitation/employee/account/SSO IDs, operation names, and safe state/time metadata. They contain no invited email or provider subject. The worker registers all eight contracts with the idempotent local history consumer; future notification/integration owners can add side effects behind the same contracts.

## Rate limiting and disclosure boundary

Inspection, provider start, and callback use a bounded in-process fixed-window limiter keyed only by technical route and network source. Invitation token, email, and provider subject are never keys or labels. Errors are generic and non-enumerating. A successfully matched secret may return `EXPIRED`, `REVOKED`, `SUPERSEDED`, or `ALREADY_USED` because possession already proves knowledge of that invitation, but responses never include employee/account details, replacement details, or email.

The limiter is not distributed and does not provide cross-instance protection. A production multi-instance deployment must add edge or shared/distributed rate limiting during production hardening; Redis is deliberately not introduced solely for T02.

## Frontend surface

The web application adds:

- `/admin/invitations`: form, list, revoke, resend, eligible terminal re-invite, explicit one-time-link copy, loading, empty, 401, 403, and error states; and
- `/onboarding`: fragment handling, provider discovery/selection, redirect, invalid, expired, revoked, superseded, used, authentication failure/retry guidance, and completion states.

The UI states that resend/re-invite rotates and generates a link and does not claim email delivery. Backend eligibility and authorization remain authoritative. With real sessions/central authorization still absent, production invitation management remains denied by design. The UI adds no HR wizard, customer onboarding, public registration, or password form.

## Production limitations and deliberately deferred work

- No production Google, Entra, SAML, or other provider is selected or configured.
- T03's in-memory transient authentication store is per process; multi-instance callback correlation needs a future shared adapter.
- The onboarding limiter is per process, not distributed.
- No application session exists; S02-T04 owns cookies/session persistence and issuance.
- Roles, permission registry, central authorization, approvals, temporary/emergency access, offboarding, and bootstrap implementation remain unauthorized.
- Invitation notification/email delivery is not added. The authorized issuer receives the one-time fragment URL for controlled delivery.
- The existing Prisma/mysql2 dependency advisory is unchanged; dependency versions were not modified by T02.
