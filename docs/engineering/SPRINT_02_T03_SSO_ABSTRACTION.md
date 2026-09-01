# Sprint 02 T03 Provider-Neutral SSO Abstraction

## Status and scope

S02-T03 implements provider-neutral authentication verification for internal employee identities. It selects no production identity provider and creates no Dar Tech application session. S02-T02 and S02-T04 through S02-T15 remain unauthorized.

The implementation adds no Prisma model or migration. It reuses the S02-T01 `SSOIdentity`, `UserAccount`, and `Employee` records only to decide whether a verified provider identity is already linked and authentication-eligible.

## Architecture

```text
HTTP /api/v1/auth
  -> AuthenticationService
     -> AuthenticationProviderAdapter
        (protocol/vendor verification stays here)
     -> AuthenticationTransactionPort
        (state, nonce, PKCE correlation, expiry, one-use replay control)
     -> AuthenticationIdentityRepositoryPort
        (read-only T01 identity/account/lifecycle lookup)
     -> InvitationAuthenticationEligibilityPort
        (deny-all until S02-T02 supplies explicit authorization)
     -> AuthenticationSecurityHook
        (typed contracts; persistence remains S02-T12)
```

Controllers parse the provider-neutral HTTP shape and invoke the application service. They contain no lifecycle, linkage, or provider-specific rules. No vendor SDK type crosses the adapter boundary.

## Provider adapter contract

Every `AuthenticationProviderAdapter` supplies safe metadata and capabilities, starts authentication, and verifies callbacks into a `NormalizedProviderIdentity`. An adapter may implement provider logout and must advertise that capability consistently.

The normalized identity contains only:

- normalized provider key and immutable provider subject;
- verified email when supplied, plus explicit verification status;
- authentication assurance level/method evidence; and
- provider authentication time when available.

Raw claims, ID/access/refresh tokens, authorization codes, vendor clients, directory groups, job titles, tenant roles, and external directory roles are not part of the normalized contract. Nothing in T03 maps external claims to Dar Tech roles or permissions.

Production adapters must declare core issuer, audience, signature, and timestamp validation as required. The contract also declares state, nonce, PKCE, redirect URI, replay, and identity-claim requirements. The application verifies that required evidence is reported, but the actual issuer/audience/signature/token/claim validation remains inside the adapter. A future Google Workspace, Microsoft Entra ID, SAML, or other adapter can implement this interface and be registered at composition time without changing the application eligibility rules.

## Authentication transaction protection

Authentication start accepts only an exact allowlisted redirect URI. The transient adapter creates cryptographically random state, nonce, and PKCE verifier material, returns the SHA-256 PKCE challenge, and gives the provider adapter the protocol inputs.

The current transaction implementation is in-memory because no production provider or production transaction store is authorized. It:

- compares state through a SHA-256 digest with constant-time comparison;
- expires transactions through an injected clock;
- atomically consumes a valid transaction once;
- retains a bounded consumed marker until expiry to distinguish and deny replay;
- passes the expected nonce and PKCE verifier only through the technical port; and
- never logs state, nonce, verifier, authorization code, or transaction contents.

The local adapter validates state and nonce a second time, uses a random one-use local authorization code, and denies reused or expired codes. PKCE is not applicable to its non-OAuth local fixture protocol; the neutral contract and transaction port supply PKCE inputs for future authorization-code adapters.

A future production adapter may require a shared transient store for multi-instance callback correlation. That remains a technical adapter behind `AuthenticationTransactionPort`, not a business entity. No production persistence solution is introduced by T03.

## Identity and lifecycle eligibility gate

After provider verification, the repository finds the globally unique `(provider_key, provider_subject)` linkage and returns its complete organization/account/employee tuple. Authentication passes the linked-account gate only when:

- the SSO identity, account, and employee organization IDs match;
- the account's employee ID matches the employee;
- employee lifecycle is `ACTIVE`;
- `authenticationEligible` is `true`; and
- `disabledAt` is null.

`INVITED`, `SUSPENDED`, `OFFBOARDING`, and `ARCHIVED` employees, disabled or ineligible accounts, inconsistent organization linkage, and unknown provider subjects fail closed.

For an unknown subject, `InvitationAuthenticationEligibilityPort` is the only future integration point. Its default adapter always denies. A test-only fake proves that S02-T02 can later return an opaque authorization reference without T03 persisting, accepting, revoking, or fabricating an Invitation. Public callback responses do not reveal whether the internal principal was linked or invitation-authorized.

## Local/test adapter restrictions

The `local` adapter is not a password login and accepts no authentication identity from a header or query parameter. It resolves an explicit local-only login hint against configured development/test fixtures and returns a random, one-use callback code.

It is disabled by default. `AUTH_LOCAL_PROVIDER_ENABLED=true` is accepted only in `development` or `test`; configuration validation and module composition both fail startup in `staging` and `production`. Development additionally requires at least one configured local identity and an allowlisted redirect. No administrator identity or privilege is hard-coded.

Relevant configuration:

| Variable | Boundary |
| --- | --- |
| `AUTH_ALLOWED_REDIRECT_URIS` | Comma-separated exact absolute HTTP(S) redirect allowlist. |
| `AUTH_TRANSACTION_TTL_SECONDS` | Transient authentication lifetime, bounded to 60-900 seconds. |
| `AUTH_LOCAL_PROVIDER_ENABLED` | Explicit local adapter opt-in; forbidden in staging/production. |
| `AUTH_LOCAL_IDENTITIES_JSON` | Development/test fixture identities only; contains no password or provider credential. |

Future provider client secrets, private keys, and credentials must enter future adapters from the validated runtime secret mechanism/reference. They must not become normal business database records. T03 introduces no production provider configuration and commits no credential.

## API contract and no-session boundary

The configured surface is:

```text
GET  /api/v1/auth/providers
POST /api/v1/auth/:providerKey/start
POST /api/v1/auth/:providerKey/callback
POST /api/v1/auth/:providerKey/provider-logout
```

Provider metadata supplies display names and icon keys. There is no signup, customer authentication, production local login, SSO configuration UI, or provider-specific business route.

A successful callback returns `VERIFIED`, `sessionCreated: false`, and `SESSION_ISSUANCE_DEFERRED`. It creates no Session record, cookie, bearer token, refresh token, or long-lived credential. The internal verified outcome is the typed input a future S02-T04 session issuer can consume after that ticket is separately authorized.

Provider logout reports its capability and URL when supported. Its response always states `applicationSessionRevoked: false`; provider logout is not Dar Tech session revocation. OpenAPI documents both boundaries.

## Failure disclosure and observability

All provider, linkage, lifecycle, account, organization, invitation, nonce, state, and replay failures use the same public error:

```text
AUTHENTICATION_FAILED
Authentication could not be completed
```

Internal failure hooks use only bounded categories. Default structured logs contain provider key, outcome, safe category, latency, request/correlation context, contract name, and the future S02-T12 persistence owner. Unknown provider inputs collapse to the `unconfigured` provider dimension. Email, provider subject, employee/account IDs, state, nonce, authorization code, and token material are not log or metric dimensions.

## Event and security-hook contracts

T03 defines:

- `AuthenticationSucceeded.v1` / `identity.authentication-succeeded` version 1;
- `AuthenticationFailed.v1` / `identity.authentication-failed` version 1; and
- the existing canonical `SSOIdentityLinked.v1` contract from T01.

T03 does not perform a link action and therefore does not emit `SSOIdentityLinked.v1`. It calls a typed `AuthenticationSecurityHook`; durable `SecurityEvent`/`AuditEvent` persistence remains owned by S02-T12.

## Frontend boundary

No frontend sign-in page is added. The current web runtime is still a Sprint 01 shell, no production provider is configured, and T03 cannot establish an application session. Provider-neutral discovery metadata and complete safe error/no-session API states are available for a future sign-in surface once the session-owning ticket is authorized. Adding a local-only pseudo-login UI now would misrepresent the authentication boundary.

## Explicitly deferred

- invitation persistence, issue/accept/revoke, and onboarding (S02-T02);
- session persistence, cookies, bearer/refresh tokens, and application logout (S02-T04);
- Google Workspace, Microsoft Entra ID, or any production provider adapter/credentials;
- roles, permissions, central authorization, approvals, temporary/emergency access;
- durable audit/security-event persistence (S02-T12);
- bootstrap administrator implementation;
- password login, public signup, customer identities, and customer login; and
- production SSO configuration UI.
