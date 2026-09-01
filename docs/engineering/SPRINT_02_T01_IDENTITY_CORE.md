# Sprint 02 T01 Identity Core

## Status and scope

This document records the S02-T01 implementation boundary. It introduces only `Organization`, `Employee`, `UserAccount`, and `SSOIdentity`. It does not authorize or implement S02-T02 through S02-T15.

The implementation deliberately contains no invitation/onboarding flow, production SSO adapter, session management, role or permission registry, central authorization engine, approval workflow, offboarding command, bootstrap administrator, password authentication, customer identity, or business module.

## Entity relationships

| Entity | Ownership and cardinality | Historical behavior |
| --- | --- | --- |
| `Organization` | Root identity/security tenant boundary with UUID, display name, and audit timestamps | Referenced records prevent organization deletion through restrictive foreign keys. |
| `Employee` | Belongs to one organization; `(organization_id, employee_code)` is unique | Account references use `RESTRICT`; there is no normal delete API. |
| `UserAccount` | Belongs to the same organization as its employee; `employee_id` is globally unique, so an employee has at most one account | Composite `(organization_id, employee_id)` foreign key prevents cross-organization attachment. |
| `SSOIdentity` | Belongs to the same organization as its account; an account may have multiple provider identities | Composite organization/account foreign key is restrictive. `(provider_key, provider_subject)` is globally unique and prevents reuse by another account. |

All primary identifiers are UUIDs. Timestamps are PostgreSQL `TIMESTAMPTZ(3)` values and are handled as UTC. No identity foreign key cascades deletion.

## Organization isolation

`Organization` is the tenant root. Every mutable child identity record stores `organization_id`. Composite foreign keys ensure that an account cannot point to an employee in another organization and an SSO identity cannot point to an account in another organization.

Repository methods require organization context as an explicit first argument and include it in every lookup or update predicate. API clients cannot submit `organization_id` as authority: the application service derives scope only from the trusted actor port. Cross-organization identifiers return the same safe `NOT_FOUND` contract as absent identifiers.

The schema includes organization-led indexes for employee lifecycle and email lookup, account eligibility, account identity linkage, and normalized verified SSO email lookup.

## Lifecycle boundary

The database enum contains exactly:

```text
INVITED → ACTIVE → SUSPENDED → OFFBOARDING → ARCHIVED
```

S02-T01 models those states and their timestamps but implements no lifecycle transition command. Suspension and offboarding behavior remain owned by later, unauthorized tickets. Generic employee and self-service PATCH parsing rejects lifecycle status, lifecycle timestamps, account authentication eligibility, and disable metadata with `IDENTITY_LIFECYCLE_MUTATION_NOT_ALLOWED`. The repository exposes no lifecycle update or delete method.

## API and fail-closed security

The versioned contracts are:

- `GET /api/v1/me`
- `PATCH /api/v1/me`
- `GET /api/v1/employees`
- `GET /api/v1/employees/:id`
- `PATCH /api/v1/employees/:id`

Administrator PATCH accepts only `firstName`, `lastName`, `displayName`, and `workEmail`. Self PATCH accepts only `displayName`. Input is trimmed and normalized before persistence.

Real SSO and the central authorization service are intentionally absent. The production defaults therefore provide no actor and no allow decision. Requests fail with `AUTHENTICATION_REQUIRED` or `AUTHORIZATION_DENIED` unless trusted ports are installed by later authorized work. There is no header/query-parameter identity shortcut, universal administrator, Founder or job-title inference, email-based privilege, or UI-based authorization.

Tests can inject actor, authorization, and audit adapters only when `APP_ENV` is `test`; registration throws for staging or production. The authorization seam currently references only `admin.employee.read`, `admin.employee.update`, and the typed authenticated self contracts.

OpenAPI is published at `/api/v1/docs` with JSON at `/api/v1/openapi.json`. PATCH schemas exclude lifecycle and account-state fields and disallow additional properties.

## Events and audit seam

S02-T01 defines these versioned contracts:

| Contract | Existing outbox type/version | Payload |
| --- | --- | --- |
| `EmployeeCreated.v1` | `identity.employee-created`, version 1 | Organization and employee IDs |
| `SSOIdentityLinked.v1` | `identity.sso-identity-linked`, version 1 | Organization, employee, account and SSO identity IDs plus provider key |
| `UserAccountActivated.v1` | `identity.user-account-activated`, version 1 | Organization, employee and account IDs |

Correlation and causation metadata belong to the existing outbox envelope. Payloads omit email, provider subject, tokens, credentials, authorization codes, and secrets. T01 owns no create/link/activate command, so it does not fabricate an action merely to emit these events; later owning tickets must persist them transactionally when those actions are authorized.

Profile mutations call a typed audit hook with actor, organization, target, action, and changed field names. The default hook logs safe structured context while durable `AuditEvent` persistence remains deferred to S02-T12.

Identity authentication, authorization, lookup, and validation failures plus profile-update success produce stable structured events. Request and correlation IDs are supplied by the existing request context. The events carry low-cardinality outcome/error fields suitable for failure counters; email and provider subject are never emitted as labels or log fields.

## Migration notes

Migration `20260901165304_sprint_02_t01_identity_core` is additive. It creates one enum, four tables, scoped indexes/uniqueness constraints, and five restrictive foreign keys. It alters or drops no Sprint 01 table or column.

Validation covers both an existing Sprint 01 schema upgraded to T01 and an empty database migrated through the complete history. Prisma validation, migration status, and schema drift checks must all pass before T01 is marked complete.

## Intentionally deferred

No frontend screen was required: the five API endpoints are the minimum employee list/detail/self data foundation. Invitation and account activation, real provider authentication, lifecycle commands, authorization policy evaluation, durable audit/security events, metrics exporter infrastructure, sessions, roles/scopes, approvals, access escalation, bootstrap, and all HR/customer/business workflows remain deferred to their owning tickets and require explicit supervisor authorization.
