# Sprint 02 T07 Central Authorization Service

## Status and boundary

S02-T07 implements the one canonical server-side `authorize(actor, action, resource, context)` decision engine and connects every current Sprint 02 protected application service to it. T04 remains the authority for session authentication and lifecycle validity; T05/T06 remain the authorities for effective role assignments and canonical permission-grant descriptors.

**T07 AUTHORIZES APPLICATION ACTIONS.**

T07 does not implement business relationship scope resolution, approval policy, step-up policy, temporary access, emergency access, offboarding, or bootstrap administration. Those remain owned by T08, T09, T10/T11, T13, and a separately authorized bootstrap ticket respectively.

## Canonical contract

The internal application contract is:

```ts
authorize(
  actor: AuthorizationActor | null,
  action: string,
  resource: AuthorizationResource,
  context: AuthorizationContext,
): Promise<AuthorizationDecision>
```

An `AuthorizationDecision` contains `allowed`, a stable safe `reasonCode`, the requested permission key, and—only on allow—a minimized matched-grant descriptor containing scope type and technical risk classification. It never exposes a raw role, RolePermission row, binding identifier, or database permission identifier.

The bounded reason codes are `AUTHORIZED`, `AUTHENTICATION_REQUIRED`, `ORGANIZATION_MISMATCH`, `PERMISSION_INVALID`, `PERMISSION_NOT_GRANTED`, `RESOURCE_INVALID`, `SCOPE_NOT_SATISFIED`, `SCOPE_RESOLVER_UNAVAILABLE`, and `AUTHORIZATION_DEPENDENCY_FAILED`. Public services continue to translate these into the existing non-enumerating 401/403/not-found contracts.

## Trusted actor path

The shared request path is:

```text
HttpOnly dartech_session cookie
→ T04 SessionService.resolveCookie
→ validated SessionPrincipal
→ request-local AuthorizationActorContext
→ module actor adapter
→ protected application service
→ module authorization adapter
→ canonical AuthorizationService
```

Only T04 resolves the cookie, checks revocation/idle/absolute expiry, validates Employee `ACTIVE`, validates account eligibility/disable state, verifies organization/account/employee ownership, and touches idle activity. The authorization actor contains session identity and assurance timestamps, including `lastStepUpAt` where available, but no role, permission, scope, Founder, job-title, or decision snapshot.

Application services retain their own typed authorization calls. Calling a use case directly without the request-local T04 principal returns `AUTHENTICATION_REQUIRED`; an HTTP guard or hidden frontend control is not the enforcement boundary.

## Decision algorithm and current authority

For each decision the service:

1. requires a structurally valid trusted actor;
2. validates the bounded resource and context;
3. denies a known organization mismatch before grant or relationship evaluation;
4. requires an exact active key in the code-owned 31-key T06 manifest;
5. queries T06 for all current effective descriptors across all current T05 role assignments;
6. evaluates every exact-action grant independently; and
7. allows when any one scope matches, otherwise denies.

The T06 repository query excludes removed/expired EmployeeRole rows, archived roles, removed/expired RolePermission rows, inactive/deprecated permissions, unknown database permission rows, and registry metadata drift. T07 performs this query for every decision and has no cross-request authorization-result cache. Grant, assignment, and role changes therefore affect the next request using the same still-valid session.

Role name, role key, employee title/profile fields, Founder state, routes, HTTP methods, and frontend state have no implicit authority. Technical permission risk is available in safe decision metadata but does not itself allow, deny, require MFA, or create an approval requirement.

## Resource and scope behavior

`AuthorizationResource` is a closed union of current Sprint 02 identity/security types. It carries only resource type, trusted organization, optional exact identifier, and optional trusted employee/account ownership identifiers.

- `ORGANIZATION` matches only after the actor/resource organization boundary succeeds.
- `SELF` matches only bounded account/session resources whose trusted employee and account ownership equals the actor. It never means every resource in the organization. Repository ownership predicates remain defense-in-depth.
- `EXPLICIT` requires exact equality between grant binding type/resource type and binding ID/resource ID. Missing identifiers, prefixes, wildcards, and inferred hierarchy deny.
- `ASSIGNED`, `TEAM`, `DEPARTMENT`, `PROJECT`, and `CUSTOMER` use the typed `AuthorizationScopeResolver` seam. T07 ships no production relationship resolver. Missing resolvers, unsupported pairs, resolver errors, and non-matches deny and never broaden to `ORGANIZATION`. Test-only resolvers prove the contract.

T08 owns real relationship resolution for extension scopes. No Project, Customer, Team, Department, or assignment business entity/query was added by T07.

## Module integration

Production/default actor and authorization providers for identity, invitation administration, roles, permission administration, audit/security event reads, and session administration now delegate to the shared T04-backed actor context and central engine. Existing test adapters remain restricted to `APP_ENV=test`.

The mapped actions are:

- identity self: `identity.account.read_self`, `identity.account.update_self`;
- employee administration: `admin.employee.read`, `admin.employee.update`;
- invitation administration: `admin.employee.invite`, `admin.invitation.read`, `admin.invitation.revoke`, `admin.invitation.resend`;
- roles: `admin.role.read`, `admin.role.create`, `admin.role.update`, `admin.role.archive`, `admin.role.assign`;
- permission administration: `admin.permission.read`, `admin.permission.manage`;
- history reads: `audit.event.read`, `security.event.read`;
- self sessions: `identity.session.read_self`, `identity.session.revoke_self`; and
- session administration: `admin.session.read`, `admin.session.revoke`.

Public provider authentication and invitation onboarding remain outside role-permission authorization and retain T02/T03 eligibility, state, nonce, PKCE, replay, and safe failure behavior.

## Cookie CSRF and OpenAPI

The shared authenticated-request middleware applies T04 exact-Origin CSRF validation to current unsafe protected cookie-authenticated `POST`, `PATCH`, and future `DELETE` paths. A valid session with a missing or foreign Origin is denied before the use case. Exact configured `SESSION_ALLOWED_ORIGINS` continue. Public authentication/onboarding and health paths are not classified as protected mutations.

OpenAPI declares only the `dartech_session` cookie scheme on protected controllers, documents 401/403 behavior, and exposes no bearer, refresh-token, raw credential, permission-debug, or authorization-check API.

## Errors, observability, and performance

Authorization failures do not disclose role names, grant existence, binding existence, cross-organization resource existence, or account-state details. Organization-scoped repositories retain safe not-found behavior after an allowed organization-level decision.

The authorization metrics port records only allow/deny, bounded reason code, fixed action family, and scope type on a match. It records no employee, session, role, resource, binding, email, or database permission identifiers. Metric/log failure is best-effort and cannot change the decision. T07 creates no authorization outbox event or durable decision table.

Each decision uses the existing single T06 effective-grant query, which joins current assignments, roles, RolePermission rows, and Permission definitions without a per-role N+1 query. There is no Redis, OPA, Cedar, durable decision cache, or authorization schema migration.

## Security verification

Unit coverage exercises canonical/unknown/malformed permissions, default deny, organization boundary, SELF, ORGANIZATION, exact EXPLICIT, multiple matching scopes, missing/negative/throwing extension resolvers, dependency failure, implicit role/title/Founder denial, and bounded metrics.

PostgreSQL/API coverage exercises a real hashed T04 cookie, the T05/T06 effective query, and every current protected domain with allowed, missing-grant, and missing-session cases. It also covers exact explicit resources, cross-organization read/mutation non-enumeration, same-session grant/assignment removal, role archival, immediate second-role union, direct use-case calls with no actor, an ungranted actor, and a currently granted actor, plus exact-Origin mutation protection with no denied mutation/audit/outbox effect.

## Deferred work

- T08: real `ASSIGNED`, `TEAM`, `DEPARTMENT`, `PROJECT`, and `CUSTOMER` resolvers.
- T09: approval and step-up policy.
- T10/T11: temporary and emergency alternate grant sources.
- T13: suspension/offboarding commands.
- Separately authorized operations work: bootstrap administration.
- Production identity-provider selection and all business modules.
