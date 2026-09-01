# ADR-0005 — Provider Abstraction and Hostinger-to-AWS Portability

**Status:** Accepted
**Date:** 2026-09-01

## Context

The first deployment target is Hostinger, while a later move to AWS must not force business or application code to adopt provider-specific identifiers, SDK types, or delivery semantics.

## Decision

Application publishers and processors depend on technical ports such as `JobQueuePort` and `OutboxStorePort`. Sprint 01 supplies PostgreSQL adapters that work on the Hostinger-first Docker stack. A future AWS adapter may use SQS or another approved service while preserving job envelopes, correlation IDs, retry expectations, deduplication behavior, and terminal state observability.

Provider construction belongs in runtime composition (`WorkerModule`), not in handlers. Provider configuration and IDs stay outside business payloads and entities.

S02-T03 applies the same decision to authentication. Application code depends on `AuthenticationProviderAdapter`, normalized identity evidence, and explicit provider capabilities. Issuer, audience, signature, timestamp, state/nonce, PKCE, redirect, replay, and identity-claim verification remain adapter responsibilities declared through the neutral contract. Callback correlation uses `AuthenticationTransactionPort`, allowing a future shared technical store without creating a business entity. No production identity provider is selected by this extension.

## Alternatives Considered

- Import a cloud SDK throughout application code: rejected because it creates lock-in and complicates local tests.
- Lowest-common-denominator abstraction over all possible providers: rejected because only proven semantics should enter the port.
- Microservice extraction for queue processing: rejected; provider substitution does not require a new service boundary.

## Consequences

- Adapters must pass the shared contract and integration tests.
- Provider-specific operational tooling can differ, but the application envelope and safety guarantees cannot silently weaken.
- Exactly-once delivery is not claimed; deduplication and consumer idempotency provide the safety boundary.
- Authentication adapters cannot leak vendor SDK objects or external group/role claims into Dar Tech domain authorization.

## Security / Data Impact

Provider credentials use external secret configuration and least privilege. Correlation metadata may cross providers, while secret-bearing payloads remain prohibited.

## Migration / Rollback

Migration to another provider is a composition/configuration change plus an adapter rollout. Pending PostgreSQL jobs must be drained or explicitly transferred before cutover; that operational plan requires supervisor approval.

## References

- `packages/queue/src/contracts.ts`
- `packages/queue/src/postgres-job-queue.ts`
- `apps/worker/src/worker.module.ts`
- `apps/api/src/auth/auth.contracts.ts`
- `apps/api/src/auth/auth.module.ts`
- `docs/engineering/SPRINT_02_T03_SSO_ABSTRACTION.md`
- `docs/engineering/SPRINT_01_FOUNDATION_GUIDE.md`
