# Dar Tech OS — Phase 16
## Entity & Database Architecture
### Status: Working Architecture — Approved Direction
### Date: 2026-08-31

> This document records the entity/domain architecture agreed during the requirements workshop. It is a business/data-model blueprint, not yet the final SQL/ORM schema. Technical deployment records support releases and environments; they are not a standalone business Deployment lifecycle.

---

## 1. Architecture Principles

1. Keep business domains modular.
2. Do not hard-code company names, employees, products, providers, or workflows.
3. Separate:
   - Employee identity vs employee profile
   - System roles vs project roles
   - Customer vs contact
   - Lead vs customer vs opportunity
   - License vs activation
   - Warranty vs updates
   - Business project state vs technical Jira state
4. Preserve historical records through archive/deactivation rather than destructive deletion.
5. Use permission-aware access throughout the system, including AI/MCP.
6. Model configurable policies rather than hard-coded commercial rules.

---

## 2. Domains

### Identity & Organization
- Organization
- Employee
- UserAccount
- SSOIdentity
- Role
- Permission
- Department
- Team

### CRM
- Lead
- LeadSource
- Customer
- Contact
- CustomerLocation
- Opportunity
- Activity

### Commercial
- Quotation
- Contract
- CommercialBenefit
- ApprovalRequest

### Delivery
- Project
- ProjectMember
- ProjectPhase
- Milestone
- Requirement
- Scope
- ChangeRequest
- Task
- Bug
- TestCase
- TestRun
- TechnicalDeploymentRecord

### Product & Licensing
- Product
- ProductVersion
- Plan
- Feature
- Entitlement
- License
- Activation
- Installation
- Release
- Rollout

### Customer Success
- Warranty
- UpdateEntitlement
- SupportTicket
- SLA
- FollowUp
- CSAT

### Finance
- Invoice
- Installment
- Payment
- PaymentAllocation
- Expense
- FinancialAccount
- Refund / Credit / Adjustment
- Reconciliation
- FinancialPeriod

### Knowledge & Communication
- Document
- File
- Meeting
- Transcript
- Communication
- Decision
- CompanyKnowledge

### Intelligence
- AutomationRule
- Notification
- IntegrityAlert
- AIConversation
- AITool
- AIContext

### Integrations
- Integration
- IntegrationJob
- Webhook
- MCPConnection

### Security
- AuditEvent
- Session
- SecurityEvent

---

## 3. Core Relationships

### Customer
Customer can have:
- many Contacts
- many Locations
- many Leads/converted histories
- many Opportunities
- many Projects
- many Contracts
- many Invoices
- many Payments
- many Tickets
- many Communications

### Project
Project can have:
- multiple Customers
- multiple Project Members
- multiple Products
- multiple Contracts
- multiple Phases
- multiple Milestones
- multiple Tasks
- multiple Change Requests
- QA records
- Jira mappings
- Technical Deployment Records
- multiple Licenses / Activations
- Warranty/Update entitlements
- Tickets
- Invoices
- Expenses
- Documents
- Meetings
- Activity

### Product
Product can have:
- many Plans
- many Features
- many Versions
- many Releases
- many Entitlements
- many Licenses

### License
License can have:
- one Product
- optional Customer for client scenarios
- optional Project
- multiple Activations
- Entitlements
- lifecycle history

### Activation
Each activation is independent and can track:
- activation key
- installation/environment
- activation date
- status
- deactivation/revocation
- history

### Entitlement
Entitlement represents what the customer/project is entitled to, such as:
- Warranty
- Updates
- Support
- Feature
- Subscription

This allows special offers and non-standard commercial terms without hard-coding them into License records.

---

## 4. Important Business Rules Already Established

### Warranty
Warranty begins at Activation, not Delivery.

### Updates
Update coverage is independent from Warranty and can have different durations.

### Projects
Projects can contain multiple Customers and multiple Products.

### Team
Projects can contain multiple Developers, Testers, and client-facing members.

### Internal Projects
Internal projects do not require a Customer and can still use products, licenses, activations, releases, updates, and cost tracking.

### Finance
Payments can be allocated across multiple invoices/installments.

### Employees
Employees are archived/deactivated rather than destructively deleted.

### AI
AI uses the user's permitted scope and must not bypass authorization.

### Integrations
External systems are connected through an Integration Hub rather than direct module-to-module coupling.

---

## 5. Domain Architecture

```text
DAR TECH OS
|
+-- Identity
|   +-- Organization
|   +-- Employees
|   +-- Accounts
|   +-- Roles
|   +-- Permissions
|
+-- CRM
|   +-- Leads
|   +-- Customers
|   +-- Contacts
|   +-- Opportunities
|
+-- Commercial
|   +-- Quotations
|   +-- Contracts
|   +-- Benefits
|
+-- Delivery
|   +-- Projects
|   +-- Phases
|   +-- Milestones
|   +-- Tasks
|   +-- QA
|   +-- Jira
|   +-- Technical Deployment Records
|
+-- Products & Licensing
|   +-- Products
|   +-- Plans
|   +-- Features
|   +-- Entitlements
|   +-- Licenses
|   +-- Activations
|   +-- Releases
|
+-- Customer Success
|   +-- Warranty
|   +-- Updates
|   +-- Tickets
|   +-- Follow-ups
|
+-- Finance
|   +-- Invoices
|   +-- Payments
|   +-- Expenses
|   +-- Accounts
|   +-- Profitability
|
+-- Knowledge
|   +-- Files
|   +-- Documents
|   +-- Meetings
|   +-- Transcripts
|   +-- Company Memory
|
+-- Intelligence
|   +-- Automation
|   +-- Search
|   +-- AI
|   +-- Integrity
|
+-- Integrations
    +-- Jira
    +-- Slack
    +-- Google
    +-- n8n
    +-- Hostinger
    +-- MCP
```

---

## 6. Finalization Status

Approved direction:
- Domain separation
- Core entities
- Major relationship patterns
- License/Activation separation
- Entitlement concept
- Project as central operational container
- Customer/Contact separation
- Employee/Account separation
- Finance payment allocation
- AI/MCP permission boundary
- Integration Hub

Still to finalize:
- Exact field names
- Exact cardinalities for a few edge cases
- State machines
- Transition permissions
- Approval triggers
- Soft-delete/archive rules by entity
- Final database constraints
- Indexes
- API representations

---

## 7. Next Phase

Phase 17 — State Machines & Lifecycle Design.

The next stage will define exact transitions and who/what can cause them for:
- Lead
- Opportunity
- Quotation
- Contract
- Project
- Task
- Change Request
- QA
- Delivery
- License
- Activation
- Warranty
- Ticket
- Invoice
- Payment
- Employee
- Approval
- Integration Job
