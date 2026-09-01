# Dar Tech OS — Phase 20
## Backend Architecture & API Design Blueprint
### Status: Recommended implementation baseline
### Date: 2026-08-31

> Purpose: convert the approved business architecture into an implementation-ready backend contract for Codex. This is not a framework tutorial; it is the engineering boundary document for building Dar Tech OS.

---

# 1. Executive Architecture Decision

## Selected baseline

- **Architecture:** Modular Monolith
- **Backend:** TypeScript + NestJS
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Deployment:** Docker
- **API:** Versioned REST API
- **Async processing:** Outbox + queue + background workers
- **Integration:** Unified Integration Hub
- **AI:** AI Gateway + Tool Registry
- **MCP:** MCP Gateway
- **Auth:** Provider-agnostic SSO abstraction

## Why Modular Monolith

Dar Tech is currently a small company with four founders, but the system is intended to scale significantly. A modular monolith provides:

- one deployable application
- one operational database initially
- simple local development
- strong domain boundaries
- easy end-to-end transactions
- low operational overhead
- a path to future service extraction when justified

Do not introduce microservices merely because there are many modules.

---

# 2. Backend Domain Map

```text
apps/api
|
+-- identity
+-- authorization
+-- crm
+-- sales
+-- commercial
+-- projects
+-- products
+-- licensing
+-- customer-success
+-- finance
+-- knowledge
+-- meetings
+-- automation
+-- intelligence
+-- integrations
+-- ai
+-- mcp
+-- notifications
+-- audit
+-- files
+-- health
```

Each domain owns its application services, domain rules, repositories, DTOs, controllers, and tests.

Cross-domain communication should prefer:
- application interfaces
- domain events
- explicit use cases

Avoid importing internal persistence details from another module.

---

# 3. Suggested Repository Structure

```text
apps/
  web/
  api/
  worker/

packages/
  ui/
  config/
  types/
  eslint-config/

services/              # logical modules, not microservices
  identity/
  authorization/
  crm/
  sales/
  commercial/
  projects/
  products/
  licensing/
  customer-success/
  finance/
  knowledge/
  meetings/
  automation/
  intelligence/
  integrations/
  ai/
  mcp/
  notifications/
  audit/
  files/

prisma/
  schema.prisma
  migrations/

infra/
  docker/
  deployment/
  scripts/

docs/
  requirements/
  architecture/
  adr/
  api/
  runbooks/
```

A single repository/monorepo is recommended unless the current codebase requires another structure.

---

# 4. Internal Module Structure

Each module should follow a predictable pattern.

```text
module/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── policies/
│   └── events/
├── application/
│   ├── commands/
│   ├── queries/
│   ├── services/
│   └── dto/
├── infrastructure/
│   ├── repositories/
│   ├── adapters/
│   └── mappers/
├── presentation/
│   ├── controllers/
│   └── serializers/
└── tests/
```

The exact physical folder structure may be simplified by Codex if the codebase remains clean and boundaries are preserved.

---

# 5. Request Flow

## Read operation

```text
HTTP Request
→ Authentication
→ Authorization
→ Controller
→ Query Handler / Application Service
→ Repository
→ PostgreSQL
→ Serializer
→ Response
```

## Business mutation

```text
HTTP Request
→ Authentication
→ Authorization
→ Validation
→ Application Command
→ Domain Rules
→ Database Transaction
→ Outbox Event
→ Audit
→ Response
```

## Async side effect

```text
Outbox Event
→ Worker / Queue
→ Subscriber
→ External Service / Notification / AI
→ Result
→ Integration/Audit record
```

---

# 6. Controllers Must Be Thin

Controllers should:
- authenticate
- validate DTOs
- invoke an application use case
- serialize the response

Controllers should NOT:
- contain business rules
- write Prisma queries directly
- execute Jira/Slack APIs
- perform financial calculations
- decide permissions with hard-coded role checks

---

# 7. Business Services / Use Cases

State-changing actions should be named business operations.

Examples:

```text
CreateProject
ApproveQuotation
SignContract
AssignProjectMember
SubmitChangeRequest
ApproveChangeRequest
RecordPayment
AllocatePayment
GenerateLicense
ActivateLicense
RevokeLicense
StartWarranty
CreateWarrantyTicket
DeliverProject
CloseProject
ArchiveProject
OffboardEmployee
```

Do not expose unrestricted `PATCH status` behavior for critical business entities.

---

# 8. API Versioning

Baseline:

```text
/api/v1/
```

Example resources:

```text
/api/v1/leads
/api/v1/customers
/api/v1/opportunities
/api/v1/quotations
/api/v1/contracts
/api/v1/projects
/api/v1/tasks
/api/v1/products
/api/v1/licenses
/api/v1/activations
/api/v1/warranties
/api/v1/tickets
/api/v1/invoices
/api/v1/payments
/api/v1/employees
```

Business commands use action endpoints where appropriate:

```text
POST /api/v1/licenses/:id/activate
POST /api/v1/licenses/:id/revoke
POST /api/v1/invoices/:id/issue
POST /api/v1/payments/:id/allocate
POST /api/v1/projects/:id/deliver
POST /api/v1/change-requests/:id/approve
```

---

# 9. Response Contract

Recommended generic response envelope:

```json
{
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

For lists:

```json
{
  "data": [],
  "meta": {
    "requestId": "...",
    "page": 1,
    "pageSize": 50,
    "total": 0
  }
}
```

The final public API contract should be documented through OpenAPI.

---

# 10. Error Contract

Use stable machine-readable error codes.

Example:

```json
{
  "error": {
    "code": "LICENSE_REVOCATION_REQUIRES_APPROVAL",
    "message": "This action requires approval.",
    "requestId": "..."
  }
}
```

Do not expose raw database errors, secrets, stack traces, or provider credentials.

---

# 11. Validation

Validation occurs at multiple boundaries:

```text
API DTO validation
→ Application validation
→ Domain rule validation
→ Database constraints
```

Never rely only on frontend validation.

---

# 12. Authorization Engine

Use one authorization service for the whole application.

Conceptual API:

```text
authorize({
  actor,
  action,
  resource,
  resourceId,
  context
})
```

It evaluates:

```text
Identity
+ Roles
+ Permissions
+ Scope
+ Resource membership
+ Policy
+ Risk
```

Never scatter rules such as:

```ts
if (role === 'admin')
```

through business code.

---

# 13. Approval Engine

Sensitive commands can invoke an approval policy.

```text
Command
→ Policy Evaluation
→ Approval Required?
   ├─ No → Execute
   └─ Yes → Approval Request
              ↓
           Approval Steps
              ↓
           Execute
```

Approval policy should be configurable.

Examples:
- license revocation
- financial adjustments
- sensitive finance exports
- permission changes
- emergency access
- production deployment

---

# 14. Transactions

Use database transactions for atomic business operations.

Required examples:

### Record payment

```text
Payment
+ Payment allocations
+ Invoice state updates
+ Financial transactions
+ Outbox event
+ Audit
```

### Activate license

```text
Activation
+ License state update
+ Warranty start
+ Renewal schedule
+ Outbox event
+ Audit
```

If any critical component fails, the transaction should roll back.

---

# 15. Outbox Pattern

All critical cross-domain events should use an outbox record created in the same transaction as the business mutation.

```text
DB Transaction
├── Business Change
└── Outbox Event

Worker
↓
Publish / Process
↓
Mark Delivered
```

This prevents the state where a business action succeeds but its required integration event disappears.

---

# 16. Event Naming

Use past-tense business events.

Examples:

```text
LeadCreated
OpportunityWon
QuotationAccepted
ContractSigned
ProjectCreated
RequirementApproved
ChangeRequestApproved
TestFailed
BugResolved
ProjectDelivered
LicenseGenerated
LicenseActivated
LicenseRevoked
WarrantyStarted
WarrantyExpiringSoon
InvoiceIssued
PaymentReceived
PaymentAllocated
TicketEscalated
EmployeeOffboarded
```

Events should be versionable when their payloads evolve.

Example:

```text
LicenseActivated.v1
LicenseActivated.v2
```

---

# 17. Workers / Queues

Worker jobs are required for:

- notifications
- emails
- Slack
- Jira synchronization
- Google synchronization
- Hostinger synchronization
- n8n calls
- transcription
- file processing
- AI analysis
- semantic indexing
- renewal reminders
- warranty reminders
- reporting refreshes
- integration retries

Workers must be observable and retryable.

---

# 18. Idempotency

Idempotency is required for actions where duplicate execution is harmful.

Especially:
- payments
- allocations
- license activation
- license generation
- license revocation requests
- webhooks
- integration commands
- financial adjustments

Recommended header:

```text
Idempotency-Key: <unique-client-key>
```

The system should persist operation results for the idempotency window/policy.

---

# 19. Concurrency / Optimistic Locking

For records that can be edited by multiple users or integrations, use optimistic concurrency control.

Recommended approaches:
- version number
- updated-at precondition
- explicit revision identifier

Particularly important for:
- quotations
- contracts
- projects
- invoices
- payments
- licenses
- requirements
- documents

---

# 20. Database Access Rules

Modules access PostgreSQL only through their repository/data-access layer.

Avoid:

```text
Controller → Prisma
```

Prefer:

```text
Controller
→ Use Case
→ Repository
→ Prisma
```

Transactions should be coordinated by application services/use cases.

---

# 21. Audit Integration

Critical commands must create audit events.

Minimum fields:
- actor
- action
- entity
- entity ID
- timestamp
- request ID
- old/new values where relevant
- session/security context where appropriate

AI tool executions and integration actions must also be auditable.

---

# 22. Files / Storage Abstraction

Application code uses:

```text
FileStorageProvider
```

not direct filesystem or provider-specific calls.

Potential implementations:

```text
Hostinger/ObjectStorageAdapter
AWS/S3Adapter
FutureProvider
```

Metadata remains in PostgreSQL; file bytes remain in object storage.

---

# 23. External Integrations

All connectors implement the Integration Provider abstraction.

Conceptual interface:

```text
connect()
disconnect()
healthCheck()
getCapabilities()
read()
write()
handleWebhook()
```

Not every provider must support every method.

Provider capabilities must be explicit.

---

# 24. Jira Adapter

Jira integration should expose:
- project mapping
- issue mapping
- configurable field mapping
- synchronization status
- webhook handling
- retry support
- conflict handling

Technical source remains Jira for mapped technical execution fields.

---

# 25. Google Adapters

Google integration should be separated into provider capabilities:

```text
Google Identity
Google Drive
Google Sheets
Gmail
Google Calendar
```

Do not make one giant `GoogleService` class.

---

# 26. Slack Adapter

Slack should support:
- event notifications
- commands
- permitted actions
- message links
- audit references

All commands must resolve the authenticated Dar Tech actor and permissions.

---

# 27. n8n Adapter

n8n is an external workflow executor.

Use:

```text
Dar Tech Event
→ n8n Connector
→ Workflow
→ Callback/Webhook
→ Dar Tech Event/Record
```

Workflow execution should have an external correlation ID.

---

# 28. Hostinger Adapter

The Hostinger adapter should be capability-driven.

Do not assume a provider operation is available merely because the system has Hostinger partnership.

Expose only verified/implemented capabilities and record provider failures.

---

# 29. AI Gateway

AI providers should be hidden behind:

```text
AIProvider
```

Capabilities can include:
- text generation
- structured extraction
- embeddings/search support
- transcription
- classification

The application should not scatter OpenAI/Anthropic-specific calls across business modules.

---

# 30. AI Context Builder

AI context should be assembled from authorized records.

```text
User
→ Permission Scope
→ Context Builder
→ Relevant Records
→ Knowledge Search
→ AI Provider
```

No unrestricted database dump.

---

# 31. AI Tool Registry

Every AI action is a registered tool with:
- tool key
- description
- input schema
- output schema
- permission
- risk level
- approval policy
- audit policy

Example:

```text
license.revoke
finance.payment.record
project.task.create
customer.search
knowledge.search
```

---

# 32. MCP Gateway

MCP is an adapter/protocol layer over the Dar Tech tool system.

```text
ChatGPT / Claude
→ MCP Gateway
→ Identity / Authorization
→ Tool Registry
→ Approval
→ Application Service
→ Audit
```

Do not implement separate business logic for MCP.

---

# 33. Search Architecture

Initial source of truth is PostgreSQL + application search.

Search can later add a dedicated search/vector engine when actual scale requires it.

Recommended abstraction:

```text
SearchProvider
```

Supporting:
- exact search
- filters
- full-text search
- semantic search

Search must enforce permissions before returning records.

---

# 34. Notifications

Notification creation should be event-driven.

```text
Business Event
→ Notification Policy
→ Notification
→ Channel Worker
```

Channels may include:
- in-app
- email
- Slack
- WhatsApp where officially integrated

Critical system/security notifications may override user preference rules according to policy.

---

# 35. Scheduled Jobs

The scheduling layer handles:

- warranty reminders
- update reminders
- renewal reminders
- follow-ups
- recurring finance forecasts
- subscription events
- report refreshes
- system cleanup according to retention policy

Schedules should be based on stored dates/policies rather than hard-coded global dates.

---

# 36. Observability

The backend should expose:

```text
/health
/health/ready
/health/live
```

Track:
- request latency
- error rate
- DB health
- queue depth
- worker failures
- integration health
- AI tool failures
- webhook failures
- job retries

Every request should carry a correlation/request ID.

---

# 37. Security Baseline

Required from the first production-ready release:

- TLS
- secure cookies/tokens according to auth strategy
- CSRF strategy where browser/session model requires it
- input validation
- output encoding
- secure headers
- rate limiting
- secret management
- least privilege
- audit logging
- sensitive data minimization
- secure file upload handling
- dependency auditing
- session revocation
- step-up authentication for sensitive operations

---

# 38. API Security

The API must enforce authorization server-side for every protected operation.

Frontend visibility is not a security control.

Example:

```text
Button hidden
≠
Permission denied
```

The backend remains authoritative.

---

# 39. Testing Strategy

Every module should include:

### Unit tests
- domain rules
- policies
- calculations

### Integration tests
- repositories
- database constraints
- external adapter behavior using mocks/fakes where appropriate

### API tests
- authentication
- authorization
- validation
- response/error contracts

### Workflow tests
- complete state transitions
- approval paths
- side effects

### End-to-end tests
- major business scenarios

---

# 40. Mandatory End-to-End Test Scenarios

At minimum:

1. Lead → Opportunity → Quotation → Contract → Project
2. Multi-customer Project
3. Multi-member Project
4. Change Request → Quotation → Approval → Scope Update
5. QA failure → Bug → Fix → Retest
6. Delivery gate → Activation
7. Activation → Warranty Start
8. Multiple activation keys
9. Invoice → Installment → Partial Payment
10. One Payment → Multiple Invoices
11. Warranty expiry → Follow-up → Renewal
12. Out-of-warranty Ticket → Paid support suggestion
13. Employee Offboarding → Ownership transfer
14. AI read operation respecting permissions
15. AI sensitive operation requiring approval
16. MCP action respecting permissions
17. Jira synchronization failure and retry
18. Google Sheets conflict detection
19. Integration webhook retry/dead-letter
20. Archive preserves historical data

---

# 41. Codex Development Rules

Codex should work in vertical slices, not create empty modules for the entire system first.

Recommended sequence for each slice:

```text
Schema
→ Domain rule
→ Use case
→ API
→ Permission
→ Event
→ Worker/side effect
→ Tests
→ Documentation
```

Do not merge a module with failing tests or unresolved type errors.

Do not refactor unrelated modules while implementing a feature unless required by an architecture boundary.

---

# 42. Definition of Done

A feature is complete only when:

- business behavior matches the specification
- DB migration exists
- validation exists
- authorization exists
- audit exists where required
- state transition is controlled
- side effects are reliable
- tests pass
- API docs are updated
- error cases are handled
- observability exists
- no sensitive information is exposed

---

# 43. Codex Phase Gate

Before Codex starts implementation of any module, it should read:

```text
01-SYSTEM-REQUIREMENTS.md
02-FEATURE-INVENTORY.md
03-DECISION-LOG.md
04-BUSINESS-LIFECYCLES.md
05-DOMAIN-ARCHITECTURE.md
06-ERD-AND-DATA-MODEL.md
07-IDENTITY-SECURITY-PERMISSIONS.md
08-INTEGRATIONS-AI-MCP.md
09-OPERATIONS-INTELLIGENCE.md
10-LEGACY-MIGRATION.md
11-NFR-AND-DEPLOYMENT.md
12-CODEX-END-TO-END-PLAN.md
13-MVP-PHASE-ROADMAP.md
14-OPEN-QUESTIONS.md
```

Then it should read the relevant Phase/module specification.

---

# 44. Human Supervisor Gate

The project owner reviews:

- schema changes affecting core entities
- permission changes
- financial logic
- licensing logic
- warranty logic
- AI action policies
- production migration
- security architecture changes
- external integration scopes

Codex may implement; it should not silently redefine business policy.

---

# 45. Future Service Extraction

If a module eventually needs independent deployment, extract it behind an existing application/domain boundary.

Likely future candidates:
- notification worker
- integration workers
- AI processing
- transcription
- search/indexing
- licensing services

Do not split them into microservices until measurable scale/ownership/reliability needs justify it.

---

# 46. Phase 20 Exit Criteria

Phase 20 is complete when the following are documented and accepted:

- backend domain boundaries
- application-layer conventions
- API versioning
- command/query pattern
- authorization architecture
- approval integration
- events/outbox
- workers/queues
- idempotency
- integration adapters
- AI/MCP gateway
- error contract
- observability
- test strategy
- Codex execution rules

Next recommended phase:
**Phase 21 — Operations Intelligence Design**, followed by frontend information architecture and final implementation backlog.
