# Dar Tech OS — Phase 26
## Final Codex Implementation Backlog & Release Plan
### Status: Recommended execution baseline
### Date: 2026-08-31

> Purpose: convert the approved Dar Tech OS requirements, architecture, data model, security model, API conventions, frontend UX, operations intelligence, event catalog, notification rules, and MCP/AI tool policies into an ordered implementation backlog that Codex can execute under human supervision.

---

# 1. Execution Principle

Codex should not build the entire platform in one pass.

The system must be delivered as **vertical slices** with explicit gates.

```text
Specification
→ Schema
→ Backend Use Case
→ API
→ Permissions
→ Events
→ Frontend
→ Tests
→ Observability
→ Documentation
→ Acceptance Gate
```

No Epic is considered complete until its acceptance gate passes.

---

# 2. Global Build Rules

Codex MUST:
- read the relevant specification before editing code;
- preserve confirmed business rules;
- avoid inventing missing business policy;
- implement one bounded slice at a time;
- write/update tests with each slice;
- run lint/typecheck/test/build before completion;
- update documentation when behavior changes;
- preserve auditability and authorization;
- use provider abstractions for infrastructure/integrations;
- keep customer portal functionality out of scope;
- keep AI/MCP inside the same authorization and approval boundaries as normal users.

Codex MUST NOT silently change:
- warranty logic;
- finance semantics;
- license lifecycle;
- permission boundaries;
- source-of-truth ownership;
- customer access scope;
- approval policy;
- audit behavior;
- retention/destructive-delete policy.

---

# 3. Recommended Release Train

```text
Release 0 — Engineering Foundation
Release 1 — Identity + CRM + Customer Core
Release 2 — Sales + Commercial
Release 3 — Projects + Execution
Release 4 — Products + Licensing + Warranty
Release 5 — Finance
Release 6 — Support + Customer Success
Release 7 — Knowledge + Meetings + Files
Release 8 — Integrations + Automation
Release 9 — Operations Intelligence
Release 10 — AI + MCP
Release 11 — Migration + Hardening + Production Readiness
```

The releases are implementation order, not necessarily public launch stages.

---

# 4. EPIC 00 — Repository & Engineering Foundation

## Objective
Create the foundation required by every later module.

## Tasks

### 00.01 Repository Structure
Create/normalize:
- web application
- API application
- worker application
- shared packages
- docs
- infrastructure
- database migrations

### 00.02 Environment Management
Implement:
- `.env.example`
- environment validation
- dev/staging/production profiles
- secret references
- no committed production secrets

### 00.03 Docker
Implement containerized:
- frontend
- API
- worker
- PostgreSQL for local/dev
- reverse proxy if required by deployment topology

### 00.04 PostgreSQL + Prisma
Implement:
- database connection
- migration workflow
- seed framework
- transaction helper
- repository conventions

### 00.05 Logging
Implement structured logging with:
- request ID
- actor/user where available
- module
- severity
- correlation ID

### 00.06 Error Framework
Implement stable API error codes and safe production responses.

### 00.07 Health Endpoints
Implement:
- `/health`
- `/health/live`
- `/health/ready`

### 00.08 CI Quality Gate
Require:
- lint
- typecheck
- unit tests
- integration tests where present
- build

## Acceptance Gate

```text
Dockerized local environment ✅
PostgreSQL migrations work ✅
API starts ✅
Worker starts ✅
Frontend starts ✅
Health checks pass ✅
CI passes ✅
No production secrets committed ✅
```

---

# 5. EPIC 01 — Identity, SSO & Security Foundation

## Objective
Build the identity and authorization layer before business modules.

## Dependencies
EPIC 00

## Core entities
- Organization
- Employee
- UserAccount
- SSOIdentity
- Role
- Permission
- EmployeeRole
- Session
- SecurityEvent
- AuditEvent

## Tasks

### 01.01 Employee Identity
Create Employee/UserAccount lifecycle.

### 01.02 SSO Provider Abstraction
Implement provider-neutral SSO contract.

Do not hard-code one final provider.

### 01.03 Session Management
Implement:
- active sessions
- expiration
- revoke session
- revoke all sessions

### 01.04 Role System
Implement multiple roles per employee.

### 01.05 Permission Registry
Create stable permission keys.

### 01.06 Authorization Service
Implement central:

```text
authorize(actor, action, resource, context)
```

### 01.07 Resource Scopes
Support organization/project/customer/resource scope evaluation.

### 01.08 Approval Foundation
Create approval requests and approval steps.

### 01.09 Temporary Permissions
Implement expiry-aware delegated/temporary access.

### 01.10 Emergency Access
Implement time-limited, reason-required, fully audited emergency access.

### 01.11 Security Events
Track:
- login
- failed login where available
- session revoke
- sensitive permission changes
- suspicious/critical actions

### 01.12 Offboarding Foundation
Disable account, revoke sessions, remove active access while preserving history.

## Frontend
- login
- account/session page
- employee list/detail
- roles/permissions admin
- approval inbox

## Acceptance Gate

```text
Individual accounts ✅
Multiple roles ✅
Fine-grained permissions ✅
Server-side authorization ✅
Session revoke ✅
Approval foundation ✅
Audit/security events ✅
Offboarding preserves history ✅
```

---

# 6. EPIC 02 — CRM & Customer Core

## Objective
Replace spreadsheet-style lead/customer tracking with structured CRM.

## Dependencies
EPIC 01

## Entities
- Lead
- LeadContact
- LeadLocation
- LeadBusinessSignal
- LeadSource
- LeadActivity
- Customer
- Contact
- CustomerLocation
- CustomerSegment

## Tasks

### 02.01 Lead CRUD + Lifecycle
Implement lead state machine.

### 02.02 Lead Research Data
Structured fields for:
- industry
- business type
- location
- company size indicators
- digital maturity
- business signals
- provenance

### 02.03 Outreach History
Track channel, contact attempt, outcome, owner, next follow-up.

### 02.04 Lead Source
Support source/referrer/campaign.

### 02.05 Duplicate Detection
Implement duplicate candidate detection and merge workflow.

### 02.06 Lead Conversion
Convert Lead → Customer while preserving Lead history.

### 02.07 Customer 360 Core
Build customer overview and relationships.

### 02.08 Contacts & Locations
Support multiple contacts and branches/locations.

### 02.09 Google Sheet Import Foundation
Build import mapping framework for existing outreach data.

## Frontend
- Lead list/workspace
- Customer list
- Customer 360
- outreach timeline
- import preview/mapping

## Acceptance Gate

```text
Lead lifecycle ✅
Lead history preserved ✅
Duplicate handling ✅
Customer conversion ✅
Multiple contacts/locations ✅
Customer 360 foundation ✅
Import preview works ✅
```

---

# 7. EPIC 03 — Sales & Opportunity Management

## Dependencies
EPIC 02

## Entities
- Pipeline
- PipelineStage
- Opportunity
- OpportunityMember
- SalesActivity
- LostReason

## Tasks

### 03.01 Pipeline Builder
Multiple configurable pipelines.

### 03.02 Opportunity Lifecycle
Implement create/move/win/lost/reopen.

### 03.03 Ownership
Primary owner + collaborators.

### 03.04 Weighted Forecast Foundation
Probability + expected close + value.

### 03.05 Sales Activity Timeline
Calls/messages/meetings/follow-ups.

### 03.06 Lost Reason Analysis
Structured lost reason capture.

## Acceptance Gate

```text
Multiple pipelines ✅
Opportunity lifecycle ✅
Reopen lost opportunity ✅
Weighted pipeline ✅
Activity timeline ✅
```

---

# 8. EPIC 04 — Quotations, Contracts & Commercial Rules

## Dependencies
EPIC 03

## Entities
- Quotation
- QuotationVersion
- QuotationItem
- Contract
- ContractVersion
- ContractCustomer
- ContractProject
- CommercialBenefit

## Tasks

### 04.01 Quotation Creation
Structured items, currency, totals.

### 04.02 Quotation Versioning
Version history + comparison.

### 04.03 Discount Approval
Configurable threshold/policy integration.

### 04.04 Negotiation History
Track revisions/notes/status.

### 04.05 Contract Lifecycle
Draft → Review → Approved → Sent → Signed → Active → Expiring → terminal states.

### 04.06 Contract Versioning
Amendments create new versions.

### 04.07 Special Commercial Benefits
Structured customer/project-specific benefits.

### 04.08 Commercial-to-Project Trigger
Configurable accepted-commercial flow.

## Acceptance Gate

```text
Quotation versions ✅
Version comparison ✅
Approval integration ✅
Contract versions ✅
Commercial benefits ✅
Project trigger policy ✅
```

---

# 9. EPIC 05 — Project Core

## Dependencies
EPIC 04

## Entities
- Project
- ProjectCustomer
- ProjectMember
- ProjectProduct
- ProjectPhase
- Milestone

## Tasks

### 05.01 Project Creation
Support types:
- Client
- Internal
- R&D
- Maintenance
- Prototype

### 05.02 Multi-Customer Relationships
Use ProjectCustomer.

### 05.03 Project Members
Multiple members and roles.

### 05.04 Project Lifecycle
Configurable default workflow.

### 05.05 Phases & Milestones
Support dependencies and completion.

### 05.06 Project Overview
Status, health placeholder, timeline, blockers, commercial summary.

## Acceptance Gate

```text
Project types ✅
Multi-customer ✅
Multi-member ✅
Roles visible ✅
Phases/milestones ✅
Internal project support ✅
```

---

# 10. EPIC 06 — Requirements, Scope, Tasks & Change Requests

## Dependencies
EPIC 05

## Entities
- Requirement
- RequirementVersion
- Scope
- ChangeRequest
- Task
- TaskDependency
- TaskWatcher
- TaskCollaborator
- TaskComment

## Tasks

### 06.01 Requirement Versioning
Structured requirements + approval.

### 06.02 Scope Management
Included/excluded scope.

### 06.03 Task System
One primary assignee, watchers/collaborators.

### 06.04 Dependencies
Blocked/dependent tasks.

### 06.05 Change Request Workflow
Assessment, commercial impact, approval, implementation.

### 06.06 Scope Creep Signals
Detect potential unapproved scope changes.

## Acceptance Gate

```text
Requirement versions ✅
Scope visible ✅
Task dependencies ✅
CR lifecycle ✅
Approved CR updates relevant scope/work ✅
Rejected CR preserves history ✅
```

---

# 11. EPIC 07 — Jira, QA & Bug Management

## Dependencies
EPIC 06

## Entities
- ExternalMapping/JiraMapping
- TestCase
- TestRun
- Bug
- BugTask

## Tasks

### 07.01 Jira Connection Abstraction
Mapping and sync state.

### 07.02 Jira Project Mapping
Dar Tech Project ↔ Jira Project.

### 07.03 Task/Issue Mapping
Task/Bug ↔ Jira issue.

### 07.04 QA
Test cases/runs/results.

### 07.05 Bug Lifecycle
Open → Triaged → In Progress → Fixed → Retest → Closed/Reopened.

### 07.06 Delivery Blocking Policy
Critical unresolved bug can block delivery unless authorized override.

### 07.07 Retry/Conflict Handling
Queue, retry, conflict state.

## Acceptance Gate

```text
Jira mappings ✅
QA lifecycle ✅
Bug lifecycle ✅
Critical blocker policy ✅
Retry handling ✅
Dar Tech/Jira ownership boundary preserved ✅
```

---

# 12. EPIC 08 — Delivery & Technical Release Tracking

## Dependencies
EPIC 07

## Important Architecture Rule
Do not create a heavy standalone business Deployment lifecycle.

Use technical deployment/release records connected to environments where needed.

## Tasks

### 08.01 Delivery Checklist
Required/optional items.

### 08.02 Delivery Gate
Validation before delivery.

### 08.03 Acceptance
Configurable formal client acceptance policy.

### 08.04 Environments
Support:
- Development
- Staging
- Production

### 08.05 Deployment Records
Immutable/append-oriented technical deployment history.

### 08.06 Authorized Override
Reason + approval + audit.

## Acceptance Gate

```text
Delivery checklist ✅
Delivery validation ✅
Acceptance policy ✅
Environment tracking ✅
Deployment history ✅
Override audited ✅
```

---

# 13. EPIC 09 — Product, Plans, Features & Releases

## Dependencies
EPIC 05

## Entities
- Product
- Plan
- Feature
- PlanFeature
- ProductVersion
- Release
- Rollout

## Tasks

### 09.01 Product Catalog
### 09.02 Plans
### 09.03 Features
### 09.04 Product Versions
### 09.05 Releases
### 09.06 Progressive Rollout
### 09.07 Targeted Rollout

## Acceptance Gate

```text
Product catalog ✅
Plan-feature relationship ✅
Version history ✅
Release lifecycle ✅
Progressive rollout ✅
Targeted rollout ✅
```

---

# 14. EPIC 10 — Licensing & Entitlements

## Dependencies
EPIC 09

## Entities
- Entitlement
- License
- ActivationKey
- Activation
- Installation

## Tasks

### 10.01 License Generation
### 10.02 Multiple Activation Keys
### 10.03 Activation Lifecycle
### 10.04 Installation History
### 10.05 Suspension/Revocation
### 10.06 Reactivation
### 10.07 Internal Project Licensing
### 10.08 Secure Key Material Handling

## Acceptance Gate

```text
Multiple activation keys ✅
Multiple activations ✅
Installation history ✅
Internal license without customer ✅
Revocation approval policy ✅
Secrets not plaintext ✅
Audit complete ✅
```

---

# 15. EPIC 11 — Warranty, Updates & Renewal Foundation

## Dependencies
EPIC 10

## Entities
- Warranty
- UpdateEntitlement
- RenewalOpportunity/FollowUp relationship

## Tasks

### 11.01 Warranty Start
Warranty begins from Activation.

### 11.02 Independent Update Coverage
Update entitlement independent from warranty.

### 11.03 Coverage & Exclusions
Structured warranty policy.

### 11.04 Expiry Scheduling
Configurable reminders.

### 11.05 Renewal Flow
Warranty/update/support/subscription renewal support.

### 11.06 Upgrade Flow
Support package/SaaS/product upgrades.

## Acceptance Gate

```text
Warranty starts from activation ✅
Warranty/update independent ✅
Coverage structured ✅
Expiry reminders configurable ✅
Renewal history preserved ✅
Upgrade flow exists ✅
```

---

# 16. EPIC 12 — Finance Core

## Dependencies
EPIC 04, EPIC 05

## Entities
- FinancialAccount
- Invoice
- InvoiceItem
- Installment
- Payment
- PaymentAllocation
- Expense
- FinancialTransaction
- FinancialPeriod

## Tasks

### 12.01 Accounts
### 12.02 Invoice Lifecycle
### 12.03 Installments
### 12.04 Partial Payments
### 12.05 Payment Allocation
### 12.06 Multi-Invoice Allocation
### 12.07 Expenses
### 12.08 Upcoming Money
### 12.09 Accounting-Lite Transaction Records
### 12.10 Financial Period Close
### 12.11 Currency Baseline
EGP/USD initially.

### 12.12 Tax-Ready Architecture
Tax engine structurally ready but disabled until policy is approved.

## Acceptance Gate

```text
Invoice lifecycle ✅
Installments ✅
Partial payments ✅
One payment → multiple invoices ✅
Expenses ✅
Upcoming Money ✅
EGP/USD ✅
No active tax calculations without policy ✅
Financial audit trail ✅
```

---

# 17. EPIC 13 — Adjustments, Reconciliation & Profitability

## Dependencies
EPIC 12

## Tasks

### 13.01 Refund/Credit/Adjustment Workflow
### 13.02 Basic Reconciliation
### 13.03 Project Profitability
### 13.04 Estimated Internal Cost
Clearly labeled estimate.

### 13.05 Forecast Foundation
Expected receivables/upcoming money.

## Acceptance Gate

```text
No silent paid-invoice mutation ✅
Adjustments approved/audited ✅
Reconciliation exists ✅
Profitability visible ✅
Estimated cost labeled as estimate ✅
```

---

# 18. EPIC 14 — Support & Customer Success

## Dependencies
EPIC 11

## Entities
- Ticket
- TicketTask
- SLAPolicy
- TicketSLAEvent
- FollowUp
- FollowUpAssignee
- CSATResponse

## Tasks

### 14.01 Ticket Lifecycle
### 14.02 Warranty Eligibility
### 14.03 Out-of-Warranty Behavior
Mark + suggest paid support/CR; do not automatically reject.

### 14.04 SLA
Configurable.

### 14.05 Escalation
### 14.06 Ticket → Task
### 14.07 Follow-Up Engine
### 14.08 CSAT
### 14.09 Customer Health Inputs

## Acceptance Gate

```text
Ticket lifecycle ✅
Warranty eligibility ✅
Out-of-warranty handling ✅
SLA/escalation ✅
Follow-ups ✅
CSAT ✅
```

---

# 19. EPIC 15 — Meetings, Communications, Files & Knowledge

## Dependencies
EPIC 02, EPIC 05

## Entities
- Meeting
- MeetingParticipant
- Communication
- File
- Document
- DocumentVersion
- Transcript
- TranscriptSpeaker
- Decision
- KnowledgePage
- KnowledgePageVersion
- SourceProvenance

## Tasks

### 15.01 File Storage Abstraction
### 15.02 Document Versioning
### 15.03 Sensitivity & Permission Checks
### 15.04 Secure External Links
### 15.05 Meetings
### 15.06 Communications Timeline
### 15.07 Transcription Pipeline
### 15.08 Speaker Resolution
### 15.09 Transcript → Summary/Decision/Task
### 15.10 Knowledge Base
### 15.11 Company Memory
### 15.12 Source Provenance

## Acceptance Gate

```text
Storage abstracted ✅
Sensitive file access ✅
Versioning ✅
Secure link controls ✅
Meetings/transcripts ✅
Knowledge search foundation ✅
Sources traceable ✅
```

---

# 20. EPIC 16 — Notifications, Automation & Scheduling

## Dependencies
Relevant prior domains

## Entities
- AutomationRule
- AutomationExecution
- Notification
- NotificationPreference
- OutboxEvent

## Tasks

### 16.01 Outbox Processor
### 16.02 Queue/Worker Framework
### 16.03 Notification Policy
### 16.04 In-App Notifications
### 16.05 Scheduled Jobs
### 16.06 Warranty Reminders
### 16.07 Renewal Reminders
### 16.08 Follow-Up Scheduling
### 16.09 Dead Letter Handling
### 16.10 Automation Execution Logs

## Acceptance Gate

```text
Outbox reliable ✅
Workers retryable ✅
Notification policy ✅
Schedules configurable ✅
Dead-letter handling ✅
Execution logs ✅
```

---

# 21. EPIC 17 — Integration Hub

## Dependencies
EPIC 16

## Entities
- Integration
- IntegrationScope
- ExternalMapping
- IntegrationJob
- Webhook
- WebhookDelivery

## Tasks

### 17.01 Integration Provider Contract
### 17.02 Secrets Reference Model
### 17.03 Webhook Infrastructure
### 17.04 Retry/Backoff
### 17.05 Health Monitoring
### 17.06 Google Workspace Adapters
### 17.07 Jira Adapter Hardening
### 17.08 Slack Adapter
### 17.09 n8n Adapter
### 17.10 Hostinger Adapter

Hostinger capabilities must be capability-driven and only implemented when supported/verified.

## Acceptance Gate

```text
Integration Hub ✅
Scopes ✅
Secrets isolated ✅
Retries ✅
Webhooks ✅
Health visibility ✅
Provider-specific logic isolated ✅
```

---

# 22. EPIC 18 — Search & Operations Intelligence MVP

## Dependencies
Business domains substantially implemented

## Entities
- Signal
- Alert
- KPI
- KPIValue
- HealthScore
- Recommendation
- SavedView
- Dashboard

## Tasks

### 18.01 Global Search
Permission-aware.

### 18.02 Command Center
### 18.03 Project Health
Explainable factor-based score.

### 18.04 Customer Health
### 18.05 Lead Intelligence Basics
### 18.06 Upcoming Money Intelligence
### 18.07 Renewal Queue
### 18.08 Team Capacity Estimate
### 18.09 Alerts
### 18.10 Saved Views
### 18.11 KPI Framework

## Acceptance Gate

```text
Command Center useful ✅
Project health explainable ✅
Customer health explainable ✅
Finance attention visible ✅
Lead analytics structured ✅
Permissions enforced in analytics ✅
```

---

# 23. EPIC 19 — Integrity Engine

## Dependencies
EPIC 18

## Tasks

Implement rules for:
- Contract vs Project
- Invoice vs Agreement
- License vs Product
- Warranty vs Entitlement
- Jira mapping vs Task/Project
- AI permission vs User permission
- missing critical data

## Acceptance Gate

```text
Conflicts detected ✅
Alerts created ✅
Resolution traceable ✅
No automatic destructive correction ✅
```

---

# 24. EPIC 20 — AI Gateway & MCP

## Dependencies
Authorization, business APIs, search, approval engine

## Entities
- AIProvider
- AIConversation
- AIMessage
- AITool
- AIToolExecution
- MCPConnection
- MCPToolBinding

## Tasks

### 20.01 AI Provider Abstraction
### 20.02 Context Builder
### 20.03 Tool Registry
### 20.04 Read Tools
### 20.05 Low-Risk Write Tools
### 20.06 High/Critical-Risk Approval Flow
### 20.07 MCP Gateway
### 20.08 ChatGPT Compatibility
### 20.09 Claude Compatibility
### 20.10 AI Audit
### 20.11 Source-Backed Answers
### 20.12 Unknown/Unverified Response Policy

## Acceptance Gate

```text
AI cannot bypass authorization ✅
AI cannot access unrestricted DB ✅
Tools have schemas ✅
Risk/approval policy ✅
MCP same business logic ✅
Source-backed answers ✅
Audit ✅
```

---

# 25. EPIC 21 — Frontend System Completion

## Dependencies
All relevant backend modules

## Tasks

### 21.01 App Shell
### 21.02 Design System
### 21.03 Permission-Aware Navigation
### 21.04 Command Center
### 21.05 Customer 360
### 21.06 Project Workspace
### 21.07 Lead Workspace
### 21.08 Finance Workspace
### 21.09 Licensing Workspace
### 21.10 Support Workspace
### 21.11 Employee Workspace
### 21.12 Knowledge Workspace
### 21.13 AI Side Panel
### 21.14 Mobile Responsive Behavior
### 21.15 Empty/Loading/Error/Permission States

## Brand requirements
Frontend visual implementation must follow the approved Dar Tech brand system, including brand identity, professional technical B2B tone, and the approved visual guidelines. Company identity and positioning must follow the canonical Dar Tech company memory. fileciteturn1file0

## Acceptance Gate

```text
Responsive ✅
Permission-aware ✅
Accessible baseline ✅
Design-system reuse ✅
Customer 360 ✅
Project Workspace ✅
Mobile usable ✅
AI not dominant over core UX ✅
```

---

# 26. EPIC 22 — Legacy Migration

## Dependencies
Target modules implemented

## Sources
- Google Sheets outreach
- Legacy Finance
- Legacy License/Serial platform
- OTP/n8n workflows
- Audio Transcriber

## Tasks

### 22.01 Migration Inventory
### 22.02 Field Mapping
### 22.03 Data Validation
### 22.04 Duplicate Strategy
### 22.05 Dry Run
### 22.06 Migration Reports
### 22.07 Historical Data Preservation
### 22.08 Compatibility Adapters
### 22.09 Rollback Plan

## Acceptance Gate

```text
Dry run successful ✅
Counts reconciled ✅
Invalid rows reported ✅
No silent data loss ✅
Audit/migration report ✅
Rollback documented ✅
```

---

# 27. EPIC 23 — Production Hardening

## Tasks

### 23.01 Security Review
### 23.02 Rate Limiting
### 23.03 Secure Headers
### 23.04 File Upload Hardening
### 23.05 Dependency Audit
### 23.06 Backup
### 23.07 Restore Test
### 23.08 Database Recovery Procedure
### 23.09 Load Testing
### 23.10 Stress Testing
### 23.11 Integration Failure Testing
### 23.12 Queue Failure Testing
### 23.13 Observability Dashboards
### 23.14 Security Event Monitoring

## Acceptance Gate

```text
Security baseline passes ✅
Backup created ✅
Restore tested ✅
Load test acceptable ✅
Critical workflows resilient ✅
Production runbooks documented ✅
```

---

# 28. EPIC 24 — Hostinger Production Deployment

## Objective
Deploy the initial production system on Hostinger while remaining AWS-portable.

## Tasks
- production infrastructure
- Docker deployment
- PostgreSQL production strategy
- object storage provider
- worker deployment
- reverse proxy
- TLS
- DNS
- secrets
- health checks
- backup scheduling
- monitoring
- rollback procedure

## Rule
Do not introduce Hostinger-specific business logic.

## Acceptance Gate

```text
Production online ✅
TLS ✅
Backups ✅
Health checks ✅
Workers ✅
Monitoring ✅
Rollback tested/documented ✅
```

---

# 29. EPIC 25 — AWS Migration Readiness

This Epic is not a day-one migration.

Its purpose is to continuously ensure portability.

## Verify
- Dockerized app
- PostgreSQL-standard features
- storage abstraction
- queue abstraction
- secrets abstraction
- provider adapters
- infrastructure configuration externalized
- migration runbook maintained

## Future cutover model

```text
Hostinger
→ Provision AWS
→ Replicate/Migrate DB
→ Copy Object Storage
→ Deploy App/Workers
→ Validate Integrations
→ DNS Cutover
→ Monitor
→ Decommission Old Environment
```

No business-module rewrite should be required.

---

# 30. MVP Release Definition

Recommended MVP includes:

### Identity
- employee accounts
- roles/permissions
- SSO abstraction
- sessions
- audit

### CRM
- Leads
- Customers
- Contacts
- Opportunities

### Commercial
- Quotations
- Contracts

### Project
- Projects
- team
- phases/milestones
- tasks
- basic requirements/scope

### Product/Licensing
- Products
- Licenses
- Activation
- Warranty

### Finance
- Invoice
- installments
- payments
- allocations
- upcoming money

### Customer Success
- Follow-ups
- basic ticketing

### Platform
- files
- notifications
- basic integrations framework
- basic Command Center

Not all advanced AI/predictive intelligence must block MVP.

---

# 31. Post-MVP Release

Recommended post-MVP priorities:

1. Jira deep sync
2. Advanced QA/Bugs
3. Change Requests
4. Release rollout
5. SLA
6. Advanced finance adjustments/reconciliation
7. Knowledge/Meetings/Transcripts
8. Integrity Engine
9. Advanced Operations Intelligence
10. MCP / AI execution tools
11. Legacy migration completion

---

# 32. Codex Ticket Template

Every Codex implementation ticket should use:

```text
ID:
Title:
Epic:
Objective:
Business Rule References:
Dependencies:
Scope:
Out of Scope:
Entities/Tables:
Backend Use Cases:
API Endpoints:
Permissions:
Approval Policy:
Events:
Notifications:
Frontend Routes/Components:
Validation:
Error Cases:
Tests:
Observability:
Acceptance Criteria:
Do Not Change:
Docs To Update:
```

---

# 33. Pull Request Gate

Every Codex PR should include:
- summary
- architecture/business rule references
- schema changes
- API changes
- permissions affected
- events emitted
- migration notes
- test evidence
- known limitations
- screenshots for UI changes where practical

Do not approve a PR that silently changes business behavior.

---

# 34. Required Automated Gates

Before merge:

```text
Lint ✅
Typecheck ✅
Unit Tests ✅
Integration Tests ✅
API/Contract Tests where relevant ✅
Build ✅
Migration Validation ✅
Security-sensitive tests where relevant ✅
```

---

# 35. Human Approval Gates

The project supervisor must explicitly review changes affecting:
- finance semantics
- warranty semantics
- licensing rules
- permissions
- approval policies
- security architecture
- production migrations
- external integration scopes
- AI high-risk actions
- destructive data operations

---

# 36. Definition of Done — Final Project

Dar Tech OS is production-ready only when:

```text
Core business workflows implemented ✅
Data model stable ✅
Authorization enforced server-side ✅
Approval flows working ✅
Audit complete ✅
Financial workflows reconciled ✅
Licensing/warranty workflows validated ✅
Backups/restores tested ✅
Integrations observable ✅
Workers resilient ✅
Frontend responsive ✅
Operations Intelligence useful ✅
AI/MCP permission-safe ✅
Legacy migration validated ✅
Security testing completed ✅
Load testing completed ✅
Production deployment runbook complete ✅
```

---

# 37. Final Implementation Sequence

Recommended exact execution sequence:

```text
00 Foundation
01 Identity/Security
02 CRM/Customer
03 Sales
04 Commercial
05 Projects
06 Requirements/Tasks/CR
07 Jira/QA/Bugs
08 Delivery/Deployments
09 Products/Releases
10 Licensing
11 Warranty/Updates/Renewals
12 Finance
13 Adjustments/Profitability
14 Support/Customer Success
15 Knowledge/Meetings/Files
16 Notifications/Automation
17 Integration Hub
18 Operations Intelligence
19 Integrity Engine
20 AI/MCP
21 Frontend Completion
22 Legacy Migration
23 Production Hardening
24 Hostinger Deployment
25 AWS Migration Readiness
```

---

# 38. Phase 26 Exit Criteria

Phase 26 is complete when:
- implementation Epics are defined;
- dependencies are ordered;
- acceptance gates are explicit;
- MVP boundaries exist;
- post-MVP scope exists;
- Codex ticket template exists;
- PR gates exist;
- human approval gates exist;
- release order exists;
- production readiness criteria exist.

Next recommended phase:
**Phase 27 — Codex Master Execution Prompt + First Sprint/Ticket Pack**, which converts this backlog into the exact initial instructions Codex should execute from a clean repository or existing codebase.
