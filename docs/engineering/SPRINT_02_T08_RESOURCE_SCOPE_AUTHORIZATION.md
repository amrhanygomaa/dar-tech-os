# Sprint 02 T08 Resource & Scope Authorization Foundation

## Closure status

**Implementation status: COMPLETED — CLOSED — MERGED.** S02-T08 was merged
through PR #13 at canonical merge/main SHA
`6402bd8c5ea6ca16ba76e2750c648506011b5cea` from final reviewed implementation
head `d746e655496699fec3eb11b525f20d4f675cd892`. The implementation introduced
no schema change or migration. S02-T09 through S02-T11 and S02-T13 through
S02-T15 remain deferred and unauthorized; this closure grants no authority to
begin them.

Final closure evidence:

- all 8/8 scope contracts are implemented and verified;
- the resolver registry and duplicate-ownership handling fail closed
  deterministically through the production Nest DI resolver seam;
- resolver metric dimensions and emission rate are bounded;
- no real business relationship resolver is installed;
- the permission registry remains 31/31;
- 256 unit tests and 134 integration tests passed; the PostgreSQL suites
  actually ran;
- all seven existing migrations apply with zero drift, with no new migration
  and no schema change; and
- no S02-T09+ implementation was introduced.

## Status and boundary

S02-T08 adds no Prisma schema change or migration, no permission key, no
business table, no authorization-check endpoint, and no real business
relationship resolver.

The T07 `AuthorizationService` remains the only component that can produce a
final authorization decision. A scope resolver answers only whether one trusted
resource relationship matches one existing canonical grant. It cannot create a
permission, approve an action, bypass organization isolation, or return ALLOW.

## Eight stable scope contracts

| Scope | T08 contract | Current production support |
| --- | --- | --- |
| `SELF` | Matches only approved account/session resource ownership where trusted employee and account ownership both match the T04 actor. It is not generic employee ownership. | Real Sprint 02 identity/session data |
| `ASSIGNED` | Matches only when an owning module's typed resolver confirms its business assignment relationship. `EmployeeRole` is never treated as this relationship. | No resolver; deny |
| `TEAM` | Matches only when an owning module's typed resolver confirms the team relationship. | No resolver; deny |
| `DEPARTMENT` | Matches only when an owning module's typed resolver confirms the department relationship. | No resolver; deny |
| `PROJECT` | Matches only when an owning module's typed resolver confirms the project relationship. Opaque IDs have no authority by themselves. | No resolver; deny |
| `CUSTOMER` | Matches only when an owning module's typed resolver confirms the customer relationship. Opaque IDs have no authority by themselves. | No resolver; deny |
| `ORGANIZATION` | Matches only after the trusted actor and resource organization IDs are equal. | Real Sprint 02 organization data |
| `EXPLICIT` | Exact `scopeBindingType === resource.type` and `scopeBindingId === resource.id`. Both values are mandatory. No prefix, wildcard, fuzzy, or hierarchy matching. | Real Sprint 02 identity/security resources |

Scope narrows an already registered permission. A resolver `MATCH` with no
canonical active permission grant still denies, as does a grant for another
permission. Multiple roles contribute a union of independently effective,
independently matching grants; scopes are never combined into a wider scope.

## Production resolver registration

An owning module implements `AuthorizationScopeResolver`, declares every exact
`scopeType`/`resourceType` capability with
`@AuthorizationScopeResolverFor(...)`, and lists the resolver as a normal Nest
provider. The class may inject repositories or application services from its
own module through normal constructor injection. The authorization module uses
Nest discovery during application bootstrap, so AppModule does not construct
resolver objects and future resolver installation does not modify
`AuthorizationService`.

The registry validates that:

- every capability uses one of the five extension scopes and a bounded
  `AuthorizationResourceType`;
- the provider implements both the capability contract and `resolve`;
- declared capabilities agree with the resolver contract; and
- exactly one production resolver owns each scope/resource pair.

Duplicate ownership rejects application bootstrap with a bounded capability
error. Registration order therefore cannot change an authorization result.
The registry is sealed after bootstrap.

T07-compatible array resolvers remain available only through the existing
`APP_ENV=test` adapter boundary. Production resolver installation uses provider
discovery, not a test adapter or preconstructed repository-dependent object.

## Trusted resolver input and fail-closed behavior

The central service validates the actor, resource, context, canonical permission
and binding descriptor before resolver use. It then projects a new bounded input
containing only:

- the trusted T04-backed actor fields;
- the trusted organization ID;
- the canonical grant descriptor;
- the bounded authorization resource fields; and
- `at` plus the bounded caller source.

Express requests, request bodies, headers, cookies, session credentials,
frontend membership claims, and arbitrary client context are not forwarded.
Organization mismatch is denied before grant lookup or resolver evaluation.

The only resolver results are `MATCH` and `NO_MATCH`. Missing capabilities,
resolver exceptions, malformed results, invalid contracts, and registry
dependency failures all deny. The public-safe T07 result remains
`SCOPE_NOT_SATISFIED` for a normal non-match and
`SCOPE_RESOLVER_UNAVAILABLE` for a missing or failed resolver. Resolver details,
relationship IDs, grant existence, and matching role details are not exposed.

## Binding and cross-organization security

`SELF` and `ORGANIZATION` reject binding data. `EXPLICIT` requires a complete
bounded binding pair and uses exact equality only. Extension scopes accept
either no binding or a complete bounded descriptor pair for an owning resolver;
partial binding pairs are rejected by the existing role-permission input
contract.

Binding equality never overrides organization isolation. A resource carrying a
different trusted organization is rejected before scope evaluation even when
its ID equals an `EXPLICIT` binding. Current identity/security behavior is
covered with PostgreSQL-backed grants and resources. Future opaque business IDs
remain non-authorizing until their owning resolver is installed.

## API, UI, audit, and events

T08 reuses the four T06 permission endpoints and `/admin/permissions`. It adds no
`/authorize`, `/authorization/check`, scope-check, lookup, or arbitrary
membership endpoint. OpenAPI documents the binding rules and the fail-closed
relationship-scope semantics.

The scope selector separates `SELF`, `ORGANIZATION`, and `EXPLICIT` from
`ASSIGNED`, `TEAM`, `DEPARTMENT`, `PROJECT`, and `CUSTOMER`. Relationship scopes
remain storable for future configuration, but the page states that they do not
authorize in the current application. There are no fabricated dropdown records
or lookup APIs.

T08 reuses `RolePermissionGranted.v1`, `RolePermissionRemoved.v1`, and existing
T12 audit/security history. Existing payload snapshots preserve
`permissionKey`, `scopeType`, `scopeBindingType`, and `scopeBindingId`. No new
scope or business-domain event is introduced.

## Resolver observability

Resolver evaluation records four bounded outcomes: `MATCH`, `NO_MATCH`,
`UNAVAILABLE`, and `ERROR`. It records only the approved scope type, bounded
resource type, outcome, and a fixed latency bucket (`LT_5_MS`, `LT_25_MS`,
`LT_100_MS`, `LT_500_MS`, or `GTE_500_MS`).

Emission is rate-bounded in a fixed time window. An identical category emits
at most once per window, and a hard global per-window cap prevents diverse
category churn from bypassing the bound. The in-memory category state is capped
by that same emission limit and is cleared when the next window begins.

Employee, account, session, role, resource, binding, email, opaque customer or
project, and raw permission database IDs are never resolver metric fields or
labels. Resolver metric failure is swallowed and never changes authorization.
No durable authorization decision history is created.

## Verification matrix

Focused unit/contract tests cover all eight scope values; positive and negative
`SELF`, `ORGANIZATION`, and exact `EXPLICIT`; missing explicit bindings; and,
for each extension scope, `MATCH`, `NO_MATCH`, missing resolver, exception,
wrong resource type, wrong binding, wrong organization, no grant, and wrong
permission. Tests also cover bounded resolver input, duplicate production
ownership rejection, real Nest dependency injection, non-authoritative
resolver behavior, independent TEAM/PROJECT union, default fail-closed runtime,
bounded resolver observability, and observability failure isolation.

PostgreSQL integration coverage uses real Sprint 02 identity/security records
for `SELF`, `ORGANIZATION`, exact `EXPLICIT`, cross-organization denial,
same-session grant removal, assignment removal, role archival, and multi-role
union. It also persists each unavailable relationship-scope grant and verifies
that the default application denies it. No PostgreSQL suite skip is accepted as
T08 evidence.

## Deferred ownership

Real assignment, team, department, project, and customer relationships—and
their tables, repositories, APIs, UI, permissions, and resolvers—belong to their
future explicitly authorized modules. Approval, temporary access, emergency
access, offboarding, bootstrap administration, and every business module remain
outside S02-T08.
