# Sprint 02 T12 Audit and Security Events

## Status and scope

S02-T12 establishes the canonical durable history layer for existing Sprint 02 identity and authentication actions. It implements `AuditEvent` and `SecurityEvent`, the four organization-scoped read endpoints, the T01 employee-profile audit integration, and the T03 authentication security-event integration.

It does not own invitations/onboarding, application sessions, roles, the permission registry or central authorization engine, approvals, temporary/emergency access, offboarding, bootstrap administration, a production SSO provider, or any business module. The separately authorized S02-T02 workflow now integrates the typed ports defined here; all other owning workflows remain deferred until separately authorized.

## Persistence architecture

Migration `20260902120000_sprint_02_t12_audit_security_events` is one additive migration. It creates:

- `audit_events`, owned by one organization and intended for required application mutation history;
- `security_events`, organization-owned when the organization is resolved and nullable only for unresolved pre-identity outcomes;
- the shared `event_risk` enum with `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL`;
- organization-led read/filter indexes and restrictive actor/account foreign keys; and
- database triggers that reject row `UPDATE` and `DELETE` on both history tables.

The migration changes no existing table or column. `TRUNCATE` is not exposed by the application and exists only as a database-operations mechanism for isolated integration-test reset and a future supervisor-approved retention operation.

Application contracts expose only append, paginated list, and organization-scoped detail reads. They expose no general update/delete command. The HTTP layer contains only:

```text
GET /api/v1/audit-events
GET /api/v1/audit-events/:id
GET /api/v1/security-events
GET /api/v1/security-events/:id
```

There is no event export, `PATCH`, or `DELETE` route.

## Event schemas

`AuditEvent` stores a UUID, required `organization_id`, stable action key, optional restrictive employee actor reference, minimal historical actor snapshot, target type/identifier and optional safe snapshot, request/correlation context, optional future session/approval references, explicitly safe reason, safe change delta, event/integrity versions, `occurred_at`, and `created_at`.

`SecurityEvent` stores a UUID, nullable unresolved `organization_id`, stable event type, bounded category, risk, outcome, optional restrictive employee/account references, safe provider key, optional future session reference, minimal actor snapshot and safe scalar context, request/correlation context, optional minimized network/device context, event version, `occurred_at`, and `created_at`.

No column exists for a password, invitation/session secret, state, nonce, authorization code, access/refresh/ID token, provider subject, login hint, raw provider payload, stack trace, or generic secret payload. Investigation metadata is not present because no investigation workflow/policy is authorized.

Current typed keys are:

```text
AUDIT
identity.account.update_self
admin.employee.update
admin.employee.invite
admin.invitation.revoke
identity.invitation.accept
identity.onboarding.complete
system.invitation.expire

SECURITY
AuthenticationSucceeded.v1
AuthenticationFailed.v1
InvitationIssued.v1
InvitationRevoked.v1
InvitationAccepted.v1
InvitationExpired.v1
OnboardingCompleted.v1
InvitationAcceptanceFailed.v1
```

Future owners extend the typed append contracts; they do not pre-create placeholder rows.

## Organization scoping and authorization

Every audit event requires an organization. Security events require an organization whenever actor/account references are present; the database check constraint rejects actor references without resolved organization scope. Composite restrictive foreign keys prevent cross-organization actor/account attachment.

All list/detail repository predicates include the trusted actor organization. An organization-scoped caller cannot read unresolved security events or another organization's records. Cross-organization and absent detail identifiers return the same safe `NOT_FOUND` result.

Read services use typed `audit.event.read` and `security.event.read` authorization ports. Because S02-T06/T07 are not implemented, production actor and authorization adapters deny by default. Test adapters can be registered only under `APP_ENV=test`; module registration throws in staging or production. There is no Founder, title, email, header, query, or development bypass.

Filters are explicit and bounded: page, page size (maximum 100), occurred range, audit action/target type, and security event type/category/outcome/risk. SQL/filter expressions and unrestricted export are not accepted.

## Historical snapshots and safe serialization

Actor snapshots contain only actor type plus the employee display name and employee code when resolved. Employee audit target snapshots contain only display name and employee code. These snapshots make a past event meaningful after a display-name, lifecycle, account, or future role change without duplicating work email or provider identity data.

The persistence mapper and API serializer are separate boundaries. Serialization reconstructs only whitelisted snapshot, delta, scalar context, network, and device fields. Unknown JSON structure and sensitive-looking context keys are discarded; append validation rejects sensitive keys such as token, nonce, state, authorization code, email, provider subject, raw payload, and stack data. Current profile deltas persist changed field names, not old/new email or profile values.

`safe_reason` is an explicitly safe-only contract. Secret-classified reasons are not accepted into this persistence path. No current T01/T03 event writes a reason.

## Transaction consistency

The T01 profile mutation now runs through an injected Prisma transaction port. Within the same transaction it:

1. resolves the actor and target through organization-scoped repository reads;
2. captures their pre-mutation minimal snapshots;
3. appends the required audit record through the transaction-aware audit port; and
4. performs the profile mutation.

If the required append fails, the profile change cannot commit. If the mutation fails after the provisional append, the event rolls back. A successful request commits both. This proves the future contract without retrofitting unrelated T01/T03 workflows.

## Current integrations

### T01 employee profile updates

Both `identity.account.update_self` and `admin.employee.update` use durable audit persistence. The record includes the trusted organization/actor, request and correlation identifiers, employee target, historical actor/target snapshot, sorted changed-field names, and version metadata.

### T03 authentication outcomes

`AuthenticationSucceeded.v1` persists an organization-scoped `SecurityEvent` for the resolved linked principal with employee/account references, safe historical actor snapshot, provider key, assurance/time/latency context, and request/correlation identifiers. It creates no application session.

`AuthenticationFailed.v1` persists only provider key, bounded failure category, latency, request/correlation identifiers, and classification. Pre-identity failure organization remains null and no employee/account reference is stored. Public failures retain the canonical non-enumerating `AUTHENTICATION_FAILED` response even when the failure persistence attempt itself fails.

Current technical default classifications are `LOW` for a successful authentication record and `MEDIUM` for an authentication failure record. These classifications do not define alert/escalation policy; production escalation remains configurable/deferred.

### T02 invitation and onboarding outcomes

Invitation issue, revoke, accept, expiry materialization, and onboarding completion append minimal organization-scoped audit/security history. Successful state mutations and their required history share the same database transaction. Invalid, reused, expired, mismatched, or transaction-failed acceptance attempts use `InvitationAcceptanceFailed.v1` with only a bounded failure category and resolved organization when safe. Raw invitation token, acceptance URL, invited email, and provider subject are never event fields.

## Observability

Persistence emits bounded operational counter events for:

- audit/security write success or failure;
- volume by safe event category and outcome; and
- security volume by approved risk.

Metrics never label employee/account identifiers, email, provider subject, token material, or event reason. Successful persistence logs the generated event ID rather than the event payload. Failures emit a critical structured error using bounded event/action/category/outcome/risk and technical error class only.

The metrics contract is adapter-based. The current adapter emits structured counter records through the approved logger; a later infrastructure ticket can connect the same bounded port to a metrics exporter without changing event persistence.

## Deliberately deferred

- Retention duration and production purge procedure require later policy approval. No cleanup/delete API is invented.
- No cryptographic hash chain, blockchain-style mechanism, or mutable correction record is implemented.
- Investigation workflow/status/notes remain absent until explicitly authorized.
- Session, approval, role, temporary/emergency access, suspension/offboarding, and bootstrap references remain optional future inputs; no fake events exist.
- No T12 frontend is added. The current web application is a Sprint 01 shell with no authenticated application session or authorization-capability contract; adding an event administration route now would prematurely implement T14 and could not provide an authoritative denied state. The four backend endpoints and safe OpenAPI contracts are the authorized operational surface until T04/T07/T14 are separately authorized.
