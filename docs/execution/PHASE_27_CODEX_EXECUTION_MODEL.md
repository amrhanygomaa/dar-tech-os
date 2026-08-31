# Dar Tech OS — Phase 27
## Codex Master Execution Prompt + First Sprint Pack
### Status: Implementation-ready baseline
### Date: 2026-08-31

> Purpose: define exactly how Codex should operate as the primary implementation agent for Dar Tech OS while the project owner acts as supervisor and approval authority.

---

# 1. Phase 27 Outcome

This phase creates three executable artifacts:

1. `CODEX_MASTER_EXECUTION_PROMPT.md` — permanent project instructions for Codex.
2. `SPRINT_01_ENGINEERING_FOUNDATION.md` — the first executable sprint.
3. This Phase 27 document — execution model, supervisor gates, and completion criteria.

The goal is not to ask Codex to build the whole system in one prompt. The goal is to make Codex work through controlled, testable vertical slices.

---

# 2. Actor Model

## Codex

Codex is the primary implementation agent.

It may:
- inspect the repository;
- propose technical implementation details within approved architecture;
- create and modify code;
- create migrations;
- create tests;
- create documentation;
- run quality checks;
- fix defects discovered while implementing the active ticket.

It may NOT silently redefine business policy.

## Project Owner / Supervisor

The supervisor approves:
- business-rule changes;
- financial semantics;
- license/warranty semantics;
- permission policy changes;
- destructive data decisions;
- production migration/cutover;
- major architecture deviations;
- new customer-facing access;
- high-risk AI/MCP policy changes.

---

# 3. Codex Execution Loop

Every ticket follows:

```text
Read ticket
→ Read referenced specifications
→ Inspect current repository
→ State assumptions only if needed
→ Implement smallest complete slice
→ Add/update tests
→ Run acceptance commands
→ Fix failures
→ Update docs
→ Produce change summary
→ Stop at ticket gate
```

Codex should not continue automatically into unrelated tickets after a ticket is complete unless explicitly instructed to continue the sprint.

---

# 4. Repository-First Rule

Codex must inspect the actual repository before creating new structure.

It must determine:
- package manager;
- current apps/packages;
- framework versions;
- database tooling;
- testing tooling;
- lint/typecheck/build scripts;
- existing CI;
- Docker files;
- environment patterns.

If working architecture already exists, prefer adapting it over replacing it.

Do not erase functioning code merely to match a diagram.

---

# 5. Source-of-Truth Order

When requirements conflict, use this precedence:

```text
1. Explicit latest supervisor decision
2. Master PRD / Decision Log
3. Phase-specific approved specification
4. System Requirements
5. Existing implementation where not contradictory
6. Technical recommendation
```

If a genuine business conflict cannot be resolved from these sources, stop that specific decision and mark it `NEEDS_SUPERVISOR_DECISION`.

Technical implementation details that do not alter business behavior may be decided by Codex within the architecture guardrails.

---

# 6. Non-Negotiable Business Guardrails

Codex must preserve:

- Dar Tech OS is an internal company operating system.
- No customer portal accounts in current scope.
- Warranty starts from Activation, not Delivery.
- Warranty and Update Entitlement are independent.
- Multiple customers may relate to one project.
- Multiple employees may work on one project with explicit roles.
- Licenses may have multiple activation keys.
- Finance supports installments and partial payments.
- Payments can be allocated across invoices/installments.
- AI/MCP cannot bypass application authorization.
- AI/MCP does not write directly to the database.
- Audit history must be preserved for critical operations.
- Historical business records are not silently hard-deleted.

---

# 7. Architecture Guardrails

Approved baseline:

```text
Frontend: React / Next.js architecture
Backend: TypeScript + NestJS
Database: PostgreSQL
ORM: Prisma
Architecture: Modular Monolith
Deployment: Docker
Async: Outbox + Background Workers
Integration: Integration Hub + Provider Adapters
AI: AI Gateway + Tool Registry
MCP: MCP Gateway over same business services
```

If the current repository materially differs, Codex should not perform a destructive migration without supervisor approval. It should document the delta and recommend the least-risk transition.

---

# 8. Module Boundary Rule

Each domain owns its internal behavior.

Examples:

```text
Projects does not own Invoice internals.
Finance does not mutate License internals.
AI does not own Project business rules.
Integrations do not become source-of-truth databases.
```

Cross-domain changes occur through explicit application services/events.

---

# 9. Database Rules

Codex must:
- use migrations;
- use foreign keys for strong relations;
- use junction tables for M:N;
- use decimal/numeric for money, never floating point;
- use UTC timestamps;
- isolate provider-specific IDs in mapping structures where practical;
- avoid JSONB for data that needs relational integrity;
- preserve organization scoping;
- avoid plaintext secrets/tokens/license secret material.

No production migration may be destructive without a documented migration/rollback plan.

---

# 10. API Rules

Use versioned API paths:

```text
/api/v1/
```

Critical lifecycle actions use explicit command endpoints.

Examples:

```text
POST /api/v1/licenses/:id/revoke
POST /api/v1/projects/:id/deliver
POST /api/v1/invoices/:id/issue
```

Do not allow generic status mutation to bypass workflow rules.

Every protected endpoint must enforce authorization server-side.

---

# 11. Security Rules

Codex must implement security as architecture, not as UI hiding.

Required patterns:
- centralized authorization;
- validation at API/application/domain/DB boundaries;
- least privilege;
- session revocation;
- secure secret management;
- request/correlation IDs;
- rate limiting where appropriate;
- audit/security events;
- approval/step-up path for high-risk actions;
- safe production errors.

---

# 12. Event / Async Rules

Critical cross-domain side effects must use reliable event/outbox processing.

Pattern:

```text
Transaction
├── Domain change
├── Audit where required
└── Outbox event

Worker
→ Subscriber
→ External or cross-domain side effect
→ Retry / Dead-letter on failure
```

Do not make a successful payment/license/project transaction depend synchronously on Slack/Jira/AI availability unless the business operation explicitly requires the external provider.

---

# 13. Quality Gate

A ticket is not done until applicable checks pass:

```text
format/lint
+ typecheck
+ unit tests
+ integration tests
+ build
+ migrations validated
```

Codex should use the repository's actual commands discovered during inspection.

If there is no quality script, Sprint 01 should create an explicit quality gate.

---

# 14. Test Requirements

For every business mutation, test:
- happy path;
- validation failure;
- unauthorized actor;
- invalid state transition;
- approval requirement where applicable;
- audit/event creation where applicable;
- idempotency/concurrency where applicable.

---

# 15. Documentation Rule

When Codex introduces:
- architecture decision;
- new environment requirement;
- migration requirement;
- new permission;
- new event;
- new integration capability;

it updates the relevant docs/ADR in the same ticket.

Code and approved documentation must not drift silently.

---

# 16. Stop Conditions

Codex must stop the affected change and report a supervisor decision request when:

1. Two approved specifications conflict on a financial rule.
2. Two approved specifications conflict on licensing/warranty behavior.
3. A requested change would create customer portal access.
4. A migration would destroy or irreversibly transform important production/history data.
5. A permission change would broaden sensitive access materially.
6. A provider requires credentials/scopes not yet approved.
7. A change would bypass approval/audit rules.
8. A requested AI/MCP tool would gain direct DB or unrestricted super-admin access.

Codex does not need to stop for ordinary low-risk technical choices such as naming an internal helper, choosing a test fixture pattern, or reorganizing a local module while preserving the architecture.

---

# 17. Ticket Completion Report

At the end of every ticket, Codex returns:

```text
Ticket:
Status:

Implemented:
- ...

Files changed:
- ...

Database changes:
- ...

Security/permissions:
- ...

Tests added/updated:
- ...

Commands run:
- ...

Results:
- ...

Documentation updated:
- ...

Risks / follow-ups:
- ...

Supervisor decision required:
- None / details
```

---

# 18. Sprint 01 Objective

**Engineering Foundation**

Sprint 01 creates the safe engineering substrate for every later domain.

It does NOT implement CRM, Finance, Projects, Licensing, or AI business features.

---

# 19. Sprint 01 Tickets

## S01-T01 — Repository Discovery & Baseline

### Objective
Create a factual technical inventory before restructuring anything.

### Work
- inspect repo tree;
- identify package manager;
- list apps/packages;
- identify frameworks and versions;
- identify database/ORM state;
- identify test/lint/build tooling;
- identify Docker/CI state;
- identify environment handling;
- run current baseline checks where possible;
- document failures that pre-exist.

### Deliverable
`docs/engineering/REPOSITORY_BASELINE.md`

### Do not
Do not restructure the project in this ticket.

### Acceptance
- repository inventory exists;
- baseline commands/results recorded;
- existing failures clearly separated from new failures.

---

## S01-T02 — Workspace / Module Skeleton

### Dependency
S01-T01

### Objective
Create/normalize the minimum architecture needed for web/API/worker/shared code while preserving working project structure.

### Deliverables
At minimum, logical boundaries for:
- web
- API
- worker/background jobs
- database/migrations
- shared configuration/types
- docs
- infrastructure

### Do not
Do not scaffold dozens of empty business modules.

### Acceptance
- frontend/API/worker boundaries are clear;
- project starts/builds after changes;
- no existing behavior is intentionally removed.

---

## S01-T03 — Environment & Configuration Foundation

### Dependency
S01-T02

### Objective
Make environment configuration explicit and validated.

### Requirements
- `.env.example` with names only / safe examples;
- typed/validated runtime config;
- dev/staging/production distinction;
- startup failure for missing critical configuration;
- no hard-coded secrets;
- no committed real credentials.

### Acceptance
- invalid critical config fails clearly;
- valid local config boots applications;
- secrets are not printed in logs.

---

## S01-T04 — PostgreSQL + Prisma Foundation

### Dependency
S01-T03

### Objective
Establish the database/migration workflow without prematurely implementing the full final schema.

### Implement
- PostgreSQL connection;
- Prisma initialization/conventions;
- migration workflow;
- seed framework;
- transaction helper/convention;
- base database health check.

### Initial data scope
Only platform foundation entities required immediately, such as organization bootstrap if necessary. Identity entities belong primarily to Sprint 02/EPIC 01 unless a minimal technical bootstrap is required.

### Acceptance
- fresh local DB can be created from migrations;
- migrations are repeatable;
- test DB workflow is documented;
- Prisma generation succeeds;
- DB connectivity health check works.

---

## S01-T05 — Docker Local Development Stack

### Dependency
S01-T04

### Objective
Run the platform locally in a predictable containerized environment.

### Target services
- PostgreSQL;
- API;
- web;
- worker;
- optional reverse proxy only if needed.

### Requirements
- persistent DB volume for dev;
- health checks;
- clear local ports;
- environment injection;
- reproducible startup.

### Acceptance
A clean developer environment can follow documented commands and bring the platform up successfully.

---

## S01-T06 — Request IDs, Logging & Error Framework

### Dependency
S01-T03

### Objective
Create consistent observability/error behavior before business APIs appear.

### Implement
- structured logger;
- request ID/correlation ID;
- safe error envelope;
- machine-readable error code convention;
- production stack-trace suppression;
- module/context fields;
- worker job correlation pattern.

### Acceptance
- every API request has a request ID;
- logs can correlate errors to requests;
- clients do not receive raw DB/provider errors;
- secrets are redacted.

---

## S01-T07 — Health / Readiness / Liveness

### Dependencies
S01-T04, S01-T06

### Implement

```text
GET /health
GET /health/live
GET /health/ready
```

Readiness should include critical dependencies such as the DB.

### Acceptance
- liveness can pass while a downstream optional integration is unavailable;
- readiness fails when a critical dependency prevents serving normal traffic;
- output is safe for production exposure.

---

## S01-T08 — Worker / Job Foundation

### Dependencies
S01-T02, S01-T06

### Objective
Create the background-job runtime foundation without binding business logic yet.

### Implement
- worker process;
- job handler convention;
- retry metadata;
- correlation IDs;
- failed-job logging;
- queue adapter interface/provider abstraction.

The initial provider can be chosen based on the actual infrastructure/repository, but it must remain replaceable for Hostinger-now/AWS-later portability.

### Acceptance
- sample non-business job can be queued/processed;
- failed job retry is testable;
- worker can start independently from API;
- queue implementation is not embedded throughout domain code.

---

## S01-T09 — Outbox Foundation

### Dependencies
S01-T04, S01-T08

### Objective
Create the reliable event-delivery foundation.

### Implement
- outbox persistence model;
- write-with-transaction convention;
- outbox dispatcher;
- event ID/version/type;
- processed/failed/retry metadata;
- idempotent dispatcher behavior.

### Acceptance
- business transaction can atomically write an outbox event;
- dispatcher processes the event;
- retry does not create duplicate successful processing in the reference test;
- failure is observable.

---

## S01-T10 — CI / Quality Gate

### Dependencies
All prior Sprint 01 technical foundations

### Objective
Prevent later Codex work from accumulating silent breakage.

### Required pipeline checks
- install/lockfile integrity;
- lint;
- typecheck;
- unit tests;
- integration tests where present;
- build;
- migration/schema validation;
- secret scanning/dependency audit if supported without introducing unstable complexity.

### Acceptance
- one documented command or CI workflow runs the complete quality gate;
- a lint/test/type failure causes the gate to fail;
- CI configuration is committed;
- local equivalent is documented.

---

## S01-T11 — Foundation Documentation / ADRs

### Dependencies
S01-T01 through T10

### Objective
Ensure architecture and operation can be understood without reading Codex chat history.

### Required docs
- repository baseline;
- local development setup;
- environment configuration;
- database/migration workflow;
- worker/queue convention;
- outbox convention;
- logging/error convention;
- quality/CI commands;
- deployment portability note.

### ADRs recommended
- ADR: Modular Monolith
- ADR: PostgreSQL + Prisma
- ADR: Dockerized Deployment
- ADR: Outbox Pattern
- ADR: Provider Abstractions / Hostinger→AWS portability

### Acceptance
A new developer/agent can set up and understand the engineering foundation from repository docs.

---

# 20. Sprint 01 Acceptance Gate

Sprint 01 is complete only if:

```text
Repository baseline documented                    ✅
App architecture preserved/normalized             ✅
Environment validation works                      ✅
PostgreSQL + Prisma migration flow works           ✅
Docker local stack works                           ✅
API starts                                         ✅
Frontend starts                                    ✅
Worker starts                                      ✅
Request/correlation IDs work                       ✅
Safe error contract works                          ✅
Health/readiness/liveness work                     ✅
Queue/job foundation works                         ✅
Outbox foundation works                            ✅
CI/quality gate passes                             ✅
Foundation docs/ADRs exist                         ✅
No business modules prematurely implemented        ✅
No production secrets committed                    ✅
```

---

# 21. Supervisor Review Checklist for Sprint 01

The supervisor should verify:

- Does the existing app still work?
- Did Codex preserve working code where possible?
- Did Codex introduce unnecessary microservices?
- Is PostgreSQL/Prisma migration repeatable?
- Are secrets excluded from source control/logs?
- Can API/web/worker run predictably?
- Can errors be traced by request ID?
- Does the worker abstraction remain portable?
- Does the outbox test prove retry safety?
- Does the quality gate genuinely fail on broken code?
- Are architecture decisions written into the repo?

If all pass, approve Sprint 01 and move to Sprint 02: **Identity, SSO, Authorization & Audit Foundation**.

---

# 22. Phase 27 Exit Criteria

Phase 27 is complete when:

- a permanent Codex master instruction file exists;
- Sprint 01 tickets are executable without guessing business behavior;
- acceptance gates exist;
- supervisor review checklist exists;
- stop conditions exist;
- Codex reporting format exists;
- the build is ready to begin with repository discovery rather than speculative scaffolding.

Next recommended phase after Sprint planning:
**Phase 28 — Sprint 02: Identity, SSO, Authorization, Approval & Audit Implementation Pack.**
