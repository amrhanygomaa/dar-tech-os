# Dar Tech OS — Phase 23
## Master PRD & Codex Build Package
### Status: Master Implementation Baseline
### Date: 31 August 2026

> This document converts the approved requirements and architecture into a build-oriented Product Requirements Document for Codex. It is the master execution reference; domain-specific documents remain authoritative for deeper details.

---

# 1. Product Definition

## Product name
Dar Tech OS

## Product type
Internal company operating system for Dar Tech.

## Primary users
- Founders / management
- Employees
- Developers
- QA/Testers
- Sales / CRM users
- Finance users
- Operations users
- License/technical operators

## Customer access
Customers do not have portal accounts in the current scope.

## Core product promise
One connected online operating environment for Dar Tech's commercial, project, product, licensing, finance, customer-success, knowledge, and intelligence workflows.

---

# 2. Product Goals

1. Replace fragmented internal tools with one connected operating system.
2. Preserve one connected history from Lead to Customer to Project to Finance/Licensing/Warranty.
3. Reduce manual data copying between Google Sheets, legacy platforms, Jira, n8n, and other tools.
4. Provide management with reliable operational visibility.
5. Make AI useful while keeping business data and sensitive actions controlled.
6. Preserve the ability to scale from the current four-founder organization to a larger company.
7. Remain deployable on Hostinger today and portable to AWS later.

---

# 3. Design / Brand Baseline

The uploaded Dar Tech Brand Guidelines define:
- Primary typeface: Poppins.
- Headings: Poppins Bold.
- Subheadings: Poppins SemiBold.
- Body: Poppins Light/Regular.
- Brand Blue: #0A4FD1.
- Deep Black: #0A0A0D.
- Pure White: #FFFFFF.
- Deep Blue accent: #063A9E.
- Neutral Gray: #8B95A8.
- Off White background: #F7F8FA.

The guideline describes a restrained blue/black/white visual system intended to feel precise, technical, and modern. fileciteturn0file0

The application should use these brand foundations without becoming a marketing website. UX remains business-software-first.

---

# 4. Product Principles

- Business-first.
- Source-backed.
- Permission-aware.
- Audit-friendly.
- Configurable where business rules vary.
- Strong defaults.
- Mobile-responsive.
- Integration-safe.
- AI-assisted, not AI-dependent.
- No destructive silent mutations of historical business data.

---

# 5. Core Business Lifecycle

```text
Lead
→ Qualification
→ Opportunity
→ Quotation
→ Contract
→ Project
→ Execution
→ QA
→ Delivery
→ Activation
→ License / Entitlement
→ Warranty / Updates
→ Support
→ Follow-up
→ Renewal / Upgrade
→ Finance
```

---

# 6. Module Map

## Identity & Security
Employee accounts, SSO, roles, permissions, scopes, MFA, sessions, approval, audit.

## CRM
Leads, customers, contacts, locations, activities, intelligence.

## Sales
Opportunities, pipelines, quotations, negotiations, discounts, forecasting.

## Commercial
Contracts, versions, commercial benefits, approvals.

## Projects
Projects, members, products, phases, milestones, requirements, scope, tasks, change requests, QA, delivery.

## Products & Licensing
Products, plans, features, versions, releases, entitlements, licenses, activation keys, activations, installations.

## Customer Success
Warranty, updates, tickets, SLA, follow-ups, renewal, CSAT, customer health.

## Finance
Invoices, installments, payments, allocations, expenses, accounts, profitability, reconciliation, financial periods, adjustments.

## Knowledge & Communication
Files, documents, meetings, transcripts, decisions, company memory, communication timeline.

## Intelligence
KPIs, dashboards, health, risk, forecasts, alerts, recommendations, search, reports, integrity.

## Integrations
Google, Jira, Slack, n8n, Hostinger, REST API, Webhooks, MCP.

## AI
AI Gateway, provider abstraction, context builder, tool registry, AI assistant, action policies.

---

# 7. Core Data Model

The physical data model is defined in the Phase 19 document and logically in Phase 18.

Critical entities include:

```text
Organization
Employee
UserAccount
Role
Permission
Lead
Customer
Contact
Opportunity
Quotation
Contract
Project
ProjectMember
Requirement
ChangeRequest
Task
Bug
TestCase
TestRun
Product
Plan
Feature
ProductVersion
Release
Entitlement
License
ActivationKey
Activation
Installation
Warranty
UpdateEntitlement
Ticket
FollowUp
Invoice
Installment
Payment
PaymentAllocation
Expense
FinancialAccount
Meeting
Transcript
Communication
File
Document
KnowledgePage
AutomationRule
Alert
AIConversation
AITool
Integration
ExternalMapping
AuditEvent
ApprovalRequest
```

---

# 8. Project as Operational Center

Project is the main operational workspace, but not the owner of unrelated domain data.

A project can have:
- multiple customers
- multiple employees/members
- multiple developers
- multiple testers
- multiple products
- multiple phases
- multiple milestones
- multiple tasks
- multiple change requests
- multiple QA runs
- multiple bugs
- multiple deployments
- multiple licenses/activations
- warranty/update entitlements
- tickets
- invoices
- expenses
- documents
- meetings

---

# 9. Project Roles

System roles and project roles are separate.

Project roles can include:
- Developer
- Tester/QA
- Project Manager
- Customer Contact Manager
- Technical Lead
- Other configurable roles

Do not hard-code employee names into project logic.

---

# 10. Lead Intelligence Requirements

Because current Dar Tech outreach is maintained in spreadsheet/PDF-style records, the new CRM must normalize the existing fields instead of preserving them only as free text.

Existing fields include:
- Name
- Business Type
- Services
- Source
- Connection
- Manager
- Status
- Notes
- Followers
- Location

The current outreach data includes categories such as Dental Clinic, Pet Clinic, Gym, Automotive, Tourism, e-commerce, and other businesses. fileciteturn0file2

The CRM must later answer:
- which industries convert best
- which locations convert best
- which services generate opportunities
- which lead sources perform best
- which owners/managers have strongest conversion
- which segments produce revenue

Do not turn incomplete spreadsheet data into unsupported market claims.

---

# 11. Finance Requirements

Initial currencies:
- EGP
- USD

Payment methods:
- InstaPay
- Bank transfer
- Cash

Required:
- invoices
- installments
- partial payments
- payment allocation
- expenses
- accounts
- upcoming money
- profitability
- refunds/credits/adjustments
- reconciliation
- financial periods
- tax-ready architecture

Taxes remain disabled until business policy is approved.

---

# 12. Licensing Requirements

- Online license/serial generation.
- Multiple activation keys per license/project context.
- Independent activations.
- Installation history.
- Product/version/release relationships.
- Entitlement-based warranty/updates/support/features/subscriptions.
- License revocation/reactivation policies.
- Audit history.

---

# 13. Warranty Requirements

Warranty begins from activation according to the confirmed business rule. fileciteturn0file4

Warranty must support:
- configurable duration
- coverage
- exclusions
- conditions
- renewal
- separate update entitlement
- special/free customer benefits

---

# 14. Support Requirements

Support ticket should know:
- customer
- project
- product
- license
- activation
- warranty
- priority
- SLA
- owner
- tasks
- resolution

Automatic warranty eligibility can produce:
- Covered
- Excluded
- Out of Warranty

Out-of-warranty cases can suggest a paid support/change-request path.

---

# 15. AI Requirements

AI must:
- respect current user permissions
- use authorized context only
- cite business evidence where possible
- distinguish fact/calculation/prediction/AI interpretation
- avoid inventing missing information
- require confirmation/approval for sensitive actions
- create audit records for material actions

AI must not access the database through an unrestricted hidden path.

---

# 16. MCP Requirements

MCP is a protocol/tool gateway.

```text
ChatGPT / Claude
→ MCP Gateway
→ Auth / Permission
→ Tool Policy
→ Approval
→ Application Service
→ Audit
```

Business logic must live in application/domain services, not MCP handlers.

---

# 17. Integration Requirements

All integrations use a reusable connector framework.

Required initial integrations:
- Google Workspace
- Google Sheets
- Google Drive
- Gmail
- Google Calendar
- Jira
- Slack
- n8n
- Hostinger
- ChatGPT
- Claude

All integrations support health state and reliable failure handling.

---

# 18. Event-Driven Rules

Critical state changes produce domain events.

Examples:

```text
LicenseActivated
→ WarrantyStarted
→ RenewalScheduleCreated
→ NotificationScheduled
```

```text
PaymentReceived
→ PaymentAllocated
→ InvoiceUpdated
→ FinanceMetricsUpdated
```

```text
WarrantyExpiringSoon
→ FollowUpCreated
→ OwnerNotified
```

Use an outbox pattern for reliable cross-domain side effects.

---

# 19. API Rules

Use versioned REST APIs:

```text
/api/v1/
```

Use domain commands for high-impact actions.

Examples:

```text
POST /projects/:id/deliver
POST /licenses/:id/activate
POST /licenses/:id/revoke
POST /payments/:id/allocate
POST /change-requests/:id/approve
POST /invoices/:id/issue
```

Do not allow clients to bypass business rules with generic status updates.

---

# 20. Error Handling

Use stable machine-readable codes.

```json
{
  "error": {
    "code": "LICENSE_REVOCATION_REQUIRES_APPROVAL",
    "message": "This action requires approval.",
    "requestId": "..."
  }
}
```

Never expose raw stack traces, secrets, SQL details, or external provider credentials.

---

# 21. State / Workflow Rules

Every meaningful transition follows:

```text
Request
→ Validation
→ Permission
→ Approval (if needed)
→ State Transition
→ Side Effects
→ Audit
```

Configurable workflows use strong defaults.

---

# 22. Permissions

Authorization evaluates:

```text
User
+ Role
+ Permission
+ Resource
+ Scope
+ Context
+ Policy
```

The frontend may hide unavailable actions but backend enforcement remains mandatory.

---

# 23. Data Security

Required:
- secure secrets storage
- encrypted transport
- scoped access
- audit logging
- MFA / step-up controls
- secure uploads
- sensitive-data minimization
- session revocation
- permission review

No plaintext API tokens or sensitive license/credential material.

---

# 24. Mobile / Responsive Requirements

The application is a responsive web application.

Mobile must prioritize:
1. critical alerts
2. tasks
3. follow-ups
4. customer/project summary
5. approvals
6. quick actions

Desktop prioritizes:
- multi-column workspaces
- tables
- dashboards
- analytics

---

# 25. Codex Implementation Method

Codex should implement in **vertical slices**.

Each slice:

```text
Schema
→ Domain Rule
→ Use Case
→ API
→ Permission
→ Event
→ Worker/Side Effect
→ Tests
→ Documentation
```

Do not implement the entire UI first or the entire database first.

---

# 26. Recommended Build Sequence

## Sprint/Stage 0 — Foundation
- repository structure
- Docker
- PostgreSQL
- Prisma
- environment/config
- logging
- API skeleton
- health checks
- CI

## Stage 1 — Identity
- employees
- accounts
- SSO abstraction
- roles
- permissions
- sessions
- audit
- approvals

## Stage 2 — CRM
- customers
- contacts
- locations
- leads
- lead sources
- activities
- opportunities
- pipeline

## Stage 3 — Commercial
- quotations
- versions
- discounts
- special benefits
- contracts
- approvals

## Stage 4 — Projects
- project
- members
- phases
- milestones
- requirements
- scope
- tasks
- dependencies
- change requests

## Stage 5 — Delivery / QA
- Jira
- QA
- bugs
- client review
- delivery checklist
- deployment

## Stage 6 — Products / Licensing
- products
- plans
- features
- versions
- releases
- entitlements
- licenses
- activations
- installations
- warranty
- updates

## Stage 7 — Finance
- accounts
- invoices
- installments
- payments
- allocations
- expenses
- profitability
- adjustments
- reconciliation

## Stage 8 — Customer Success
- tickets
- SLA
- warranty eligibility
- follow-ups
- renewal
- CSAT

## Stage 9 — Knowledge
- files
- documents
- meetings
- transcripts
- decisions
- knowledge base

## Stage 10 — Intelligence
- dashboards
- KPIs
- health
- risk
- alerts
- reports
- search
- integrity engine

## Stage 11 — Integrations / AI
- Google
- Slack
- n8n
- Hostinger
- MCP
- ChatGPT
- Claude

## Stage 12 — Migration / Hardening
- legacy migration
- Google Sheets migration
- security testing
- performance testing
- restore testing
- production hardening

---

# 27. Definition of Done

A feature is complete only when:
- business behavior matches requirements
- DB migration exists
- validation exists
- authorization exists
- audit exists when required
- state transition is controlled
- error cases are handled
- tests pass
- docs are updated
- observability exists
- no unrelated behavior regresses

---

# 28. Codex Guardrails

Codex must not silently:
- alter warranty semantics
- alter payment semantics
- grant permissions
- change source-of-truth boundaries
- delete historical records
- create customer portal access
- enable unrestricted AI actions
- bypass approval policies
- introduce provider-specific coupling into domain logic
- invent unsupported business requirements

When an implementation conflict is discovered, Codex should flag the conflict rather than silently selecting a new business rule.

---

# 29. Human Approval Gates

Owner review is required for:
- core schema changes
- financial logic
- license logic
- warranty logic
- permission changes
- security-policy changes
- sensitive AI tools
- production migrations
- external integration scopes
- changes to confirmed business decisions

---

# 30. Phase 23 Exit Criteria

The Master PRD is considered ready for Codex execution when:
- all major domains are documented
- business lifecycle is documented
- entity model exists
- state machines exist
- permissions are defined conceptually
- API architecture exists
- integration boundaries exist
- AI/MCP policy exists
- UX architecture exists
- build order exists
- open questions are explicitly isolated

Next phase:
**Phase 24 — Final Permission Matrix + Approval Matrix + API Contract Pack.**
