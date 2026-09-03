# Sprint 02 T06 Permission Registry

## Delivered boundary

S02-T06 introduces the code-owned, product-global `Permission` registry and the
organization-scoped, historical `RolePermission` grant ledger. It also provides
the four approved administration routes, an internal permission catalog and
grant-history UI, explicit registry synchronization and validation commands,
and a query that returns effective grant descriptors for a currently effective
employee-role assignment.

**T06 does not authorize application actions.** The descriptor query does not
return an allow/deny decision and does not resolve resource scope. The central
`authorize(actor, action, resource, context)` contract and scope-resolution
policy remain owned by S02-T07 and S02-T08. Approval, temporary access, and
emergency-access behavior remain owned by later tickets.

## Canonical permission catalog

`apps/api/src/permissions/permission-manifest.ts` is the single code-owned
definition source. Keys are immutable, lowercase, exactly three segments in the
form `<domain>.<resource>.<action>`, and contain no wildcard. The initial catalog
contains exactly these 31 permissions:

| Permission | Risk |
| --- | --- |
| `identity.account.read_self` | LOW |
| `identity.account.update_self` | MEDIUM |
| `identity.session.read_self` | LOW |
| `identity.session.revoke_self` | MEDIUM |
| `admin.employee.read` | LOW |
| `admin.employee.update` | MEDIUM |
| `admin.employee.invite` | MEDIUM |
| `admin.employee.suspend` | HIGH |
| `admin.employee.offboard` | HIGH |
| `admin.invitation.read` | LOW |
| `admin.invitation.revoke` | MEDIUM |
| `admin.invitation.resend` | MEDIUM |
| `admin.role.read` | LOW |
| `admin.role.create` | MEDIUM |
| `admin.role.update` | MEDIUM |
| `admin.role.archive` | MEDIUM |
| `admin.role.assign` | HIGH |
| `admin.permission.read` | LOW |
| `admin.permission.manage` | CRITICAL |
| `admin.session.read` | LOW |
| `admin.session.revoke` | MEDIUM |
| `admin.sso.read` | LOW |
| `admin.sso.manage` | CRITICAL |
| `admin.access.temporary` | HIGH |
| `admin.access.revoke` | HIGH |
| `admin.access.emergency` | CRITICAL |
| `approval.request.read` | MEDIUM |
| `approval.request.approve` | HIGH |
| `approval.request.reject` | HIGH |
| `security.event.read` | HIGH |
| `audit.event.read` | HIGH |

`admin.invitation.resend` is deliberately included because invitation resend
semantics already exist in the approved Sprint 02 contract. No business-module
permission was added. Risk is technical security metadata and is not an
approval decision.

## Persistence and tenancy

`Permission` is product-global. It stores the stable key and decomposed
domain/resource/action metadata, description, risk classification, active and
deprecation metadata, a definition version, and timestamps. A PostgreSQL
constraint validates the key shape and a trigger rejects key changes.

`RolePermission` is organization-scoped and append-preserving. Each record owns
its grant, effective, expiry, and removal metadata and issuer/remover references.
All organization, role, permission, and employee relations use restrictive
foreign keys. Grant mutations lock the role before matching grant rows so they
remain compatible with the T05 role-archive lock order. Exact concurrent repeats
are idempotent; a simultaneous effective grant with different scope metadata or
expiry is a conflict. Removed or expired grants remain historical, and a later
grant creates a new row. Effectiveness uses `effectiveAt <= now`, no removal,
and `now < expiresAt` when expiry exists, so a grant is ineffective at the exact
expiry instant without waiting for worker cleanup.

`ScopeType` stores the eight approved values: `SELF`, `ASSIGNED`, `TEAM`,
`DEPARTMENT`, `PROJECT`, `CUSTOMER`, `ORGANIZATION`, and `EXPLICIT`. T06 only
stores and returns these descriptors. Project and Customer identifiers are
opaque strings; this ticket creates no Project or Customer entity or policy.

The T12 `AuditEvent.organizationId` column is nullable only for a narrowly
constrained system permission-registration event. Database validation requires
such a row to have no employee actor, action `system.permission.register`,
target type `permission`, and an actor snapshot whose type is `system`. All
tenant administration audit rows remain organization-scoped.

## Registry operations

Registry mutation is explicit and never occurs during API startup:

```shell
npm run permissions:sync
npm run permissions:validate
```

Run database migrations first, then `permissions:sync`, then
`permissions:validate`, and only then roll out code that depends on the catalog.
The sync command is additive. It registers missing canonical entries and safely
updates description text. It refuses key renames, incompatible definition
versions, domain/resource/action changes, risk changes, activation changes, and
deprecation changes. It never removes an unknown persisted row. Validation is
read-only and reports missing keys, malformed or duplicate keys, metadata drift,
unknown active permissions, incompatible versions, and invalid grant references.

Every newly registered permission atomically appends a constrained global
system audit record and `PermissionRegistered.v1` outbox event. A failed audit
or outbox append rolls back the registry row. Deprecation behavior and
`PermissionDeprecated.v1` are intentionally not implemented in this ticket.

## Administration API and security boundary

The only T06 routes are:

- `GET /api/v1/permissions`
- `GET /api/v1/roles/:id/permissions`
- `POST /api/v1/roles/:id/permissions`
- `POST /api/v1/roles/:roleId/permissions/:permissionKey/remove`

Requests derive actor and organization context from typed ports; body, path,
query, role name, and job title are never authority. Production adapters are
deny-by-default until T07 supplies the central authorization integration. The
T06-specific port recognizes only `admin.permission.read` and
`admin.permission.manage`; missing identity or any absent/invalid decision
denies access. Its deliberately narrow method is named `allows(...)`, not the
canonical T07 `authorize(actor, action, resource, context)` contract. Grant input
accepts an exact allowlist of fields and rejects
arbitrary permission strings, unknown registry entries, inactive entries, and
deprecated entries.

Grant and removal append `RolePermissionGranted.v1` and
`RolePermissionRemoved.v1` through the transactional outbox. Permission
management also appends the required T12 audit history and CRITICAL security
events in the same transaction. No secret, token, raw header, or unbounded
resource identifier is recorded in metrics.

The effective-grant repository query unions grants across all currently
effective employee-role assignments, excludes archived roles and
expired/removed assignments or grants, and requires exact canonical registry
metadata. Unknown or drifted database strings never become effective
descriptors.

## Internal UI

`/admin/permissions` displays the catalog grouped by domain/resource with risk
and active state, provides explicit scope/binding/expiry grant controls, and
loads paginated persisted grant history for a selected role. It distinguishes
loading, empty, unauthenticated, forbidden, validation, conflict, and general
error states. UI visibility is not authorization; the API remains authoritative.

## Verification coverage

Unit and integration coverage includes exact catalog shape and risks, key and
scope validation, unknown/inactive/deprecated denial, tenant isolation,
multi-role descriptor unions, assignment/grant expiry, role archival, historical
removal and regrant, exact idempotency, conflicting scopes, duplicate concurrent
grants, grant-versus-remove and grant-versus-archive races, audit/security/outbox
atomic rollback, registry drift, additive synchronization, restrictive foreign
keys, OpenAPI, worker event routing, UI states, fresh migration application, and
upgrade preservation from the canonical main schema.

## Deferred work

- Central authorization and final allow/deny evaluation: S02-T07.
- Resource-scope resolvers: S02-T08.
- Approval and step-up enforcement: S02-T09 and later approved tickets.
- Permission deprecation workflow and event: a separately approved design.
- All business-module entities, permissions, APIs, pages, and policies.
