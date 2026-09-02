# Sprint 02 T05 Role Model

## Status and scope

S02-T05 implements customizable organization-scoped `Role` records and historical many-to-many `EmployeeRole` assignments. It adds the six authorized role-management routes, minimum internal role administration UI, durable T12 audit integration, five transactional outbox contracts, bounded observability, and a stable effective-role query contract for future authorization work.

It does not implement application sessions, a permission registry, `RolePermission`, the central authorization service, resource scopes, approvals, temporary/emergency access, offboarding, bootstrap administration, a production SSO provider, customer accounts, or public signup.

> **A ROLE HAS NO PERMISSIONS IN T05.** A role named Founder, Owner, Admin, Super Admin, Finance, or any job title receives zero implicit application authority.

## Data architecture and organization scope

The authoritative relationship is:

```text
Organization 1 ── * Role
Employee     1 ── * EmployeeRole * ── 1 Role
```

There is no `role_id` column on `Employee`. Every distinct assignment is a separate `EmployeeRole` history row, so one employee can hold multiple roles simultaneously and a later reassignment never overwrites prior history.

Both tables carry `organization_id`. Composite foreign keys require Employee, Role, assigner, and remover to belong to the same organization. All lifetime relations use `ON DELETE RESTRICT`; no role or assignment delete endpoint exists. Repository reads and mutations always include the trusted actor organization, and cross-organization targets use the same `NOT_FOUND` result as absent targets.

Migration `20260902230000_sprint_02_t05_role_model` is additive. It creates only `roles` and `employee_roles`, their checks, indexes, and restrictive foreign keys. It does not alter or remove existing identity, invitation, audit, security, queue, or outbox data.

## Role normalization and immutable key

Role creation accepts `key`, `name`, and optional `description`:

- key: trim, lowercase, 1–64 characters, no controls or whitespace, and the stable safe format `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`;
- display name: reject control characters, trim, collapse whitespace, and limit to 160 characters;
- normalized name: deterministic lowercase of the normalized display name;
- description: optional, trimmed/collapsed, control-character-free, and limited to 500 characters.

Database checks reinforce key/name normalization. `(organization_id, role_key)` and `(organization_id, normalized_name)` are unique. The same key/name may exist in separate organizations.

The stable role key is immutable. `PATCH /roles/:id` accepts only `name` and `description`; attempts to patch `key` fail with `ROLE_KEY_IMMUTABLE`. Organization, archive state, IDs, and timestamps are not mutable through PATCH.

## Archive semantics

`POST /api/v1/roles/:id/archive` is the only archive command. It sets `archived_at` and preserves the Role plus every EmployeeRole history row. Repeating archive is idempotent and emits no duplicate audit/outbox history. There is no unarchive command and no generic status patch.

An archived role:

- cannot receive a new assignment;
- is excluded immediately from the effective-role query;
- does not cause assignment rows to be deleted or rewritten; and
- does not fabricate `EmployeeRoleRemoved.v1` events for existing assignments.

## EmployeeRole history and expiry

Each assignment records organization, employee, role, assigner, assigned/effective timestamps, optional expiry, optional later removal/remover, and audit timestamps. `effective_at` defaults to the trusted command time. T05 does not implement scheduled future activation.

An assignment is effective at trusted time `now` only when:

```text
effective_at <= now
AND removed_at IS NULL
AND (expires_at IS NULL OR now < expires_at)
AND role.archived_at IS NULL
```

At exactly `now == expires_at`, the assignment is ineffective. Every query evaluates time directly through an injectable clock; no worker or materialized expiry status is required. Expired and removed rows remain historical and can be followed by a new assignment row.

Removal uses `POST /api/v1/employees/:employeeId/roles/:roleId/remove`. It sets `removed_at` and `removed_by_employee_id`. Repeated removal is idempotent and never deletes history or duplicates audit/outbox records.

## Duplicate assignment and concurrency strategy

There is deliberately no lifetime uniqueness constraint on `(employee_id, role_id)`, because that would prevent legitimate reassignment after expiry/removal.

Assignment, removal, and archive use PostgreSQL transaction row locks in a consistent order:

```text
Role row → Employee row → matching EmployeeRole history rows
```

The locked history is checked against the trusted command time before insert. Concurrent duplicate assignment of the same role/employee therefore creates at most one new effective row. An exact duplicate returns the existing assignment idempotently with no duplicate audit/outbox event. A duplicate with materially different expiry semantics returns `EMPLOYEE_ROLE_ASSIGNMENT_CONFLICT`.

Different-role assignments may both succeed and never overwrite one another. Archive-versus-assign and remove-versus-assign races serialize to a safe terminal state. The implementation does not use sleeps, process-local mutexes, cleanup-dependent uniqueness, or worker-enforced expiry.

## API and authorization boundary

The authorized routes are:

```text
GET   /api/v1/roles
POST  /api/v1/roles
PATCH /api/v1/roles/:id
POST  /api/v1/roles/:id/archive
POST  /api/v1/employees/:id/roles
POST  /api/v1/employees/:employeeId/roles/:roleId/remove
```

Organization scope is never accepted from request data. The exact typed permission references are:

```text
admin.role.read
admin.role.create
admin.role.update
admin.role.archive
admin.role.assign
```

S02-T07 does not yet exist. T05 therefore uses a narrow typed actor and role-administration authorization port. Production/default adapters provide no actor and no allow decision: missing actor returns `AUTHENTICATION_REQUIRED`; missing/negative authorization returns `AUTHORIZATION_DENIED`. Test adapters can be installed only under `APP_ENV=test`, and module registration fails outside test.

No role name, employee/job title, Founder state, email, employee code, request header, query parameter, or frontend state is an authorization input. T05 does not implement the canonical `authorize(actor, action, resource, context)` engine.

The exported `RoleRepositoryPort.listEffectiveRolesForEmployee(organizationId, employeeId, at)` contract returns every effective, non-archived assignment. Future S02-T06 supplies permission grants and S02-T07 combines lifecycle, account/session state, all effective roles, permissions, scope, and policy into the final authorization decision.

## T12 audit and transactional outbox

Every non-idempotent successful mutation appends required T12 audit history and its outbox event in the same Prisma transaction as the mutation. Audit or outbox failure rolls the entire transaction back.

| Mutation | Audit key | Outbox contract / type |
| --- | --- | --- |
| Create role | `admin.role.create` | `RoleCreated.v1` / `identity.role-created` |
| Update role | `admin.role.update` | `RoleUpdated.v1` / `identity.role-updated` |
| Archive role | `admin.role.archive` | `RoleArchived.v1` / `identity.role-archived` |
| Assign role | `admin.role.assign` | `EmployeeRoleAssigned.v1` / `identity.employee-role-assigned` |
| Remove role | `admin.role.assign` | `EmployeeRoleRemoved.v1` / `identity.employee-role-removed` |

Payloads contain only organization, role, employee, EmployeeRole identifiers and relevant occurred/effective/expiry timestamps. They exclude role name/description, employee PII, permission grants, and arbitrary request input. The existing worker registry routes all five contracts through its idempotent local history consumer.

## Observability

The role metrics port records bounded operation/outcome and missing-actor/authorization-denial categories for list, create, update, archive, assign, and remove. It does not use employee ID, role ID, name, email, or employee name as metric labels. Structured completion/failure logs contain bounded operation/outcome/error-category fields and never act as authorization evidence.

## Frontend boundary

`/admin/roles` provides the minimum T05 foundation for role list/create/detail/edit/archive and role assignment/removal results, including effective/expiry/removed state and multiple-role results. It includes loading, empty, unauthorized, forbidden, conflict, validation, and generic-error states and explicitly states that a T05 role has no permissions.

Backend authorization remains authoritative. Because S02-T04/T07 are not implemented, default production role-management requests remain denied. The UI creates no session/authentication bypass and contains no permission-grant controls.

## Deferred policy and ownership

- S02-T06 owns permission registry persistence and role-to-permission grants.
- S02-T07 owns the canonical authorization engine and final multi-role permission evaluation.
- S02-T09 owns approval policy; T05 does not invent self-assignment, two-person, Founder, threshold, or override rules.
- S02-T13 owns employee suspension/offboarding and assignment cleanup behavior.
- No initial/privileged role seed or bootstrap administrator is created.
