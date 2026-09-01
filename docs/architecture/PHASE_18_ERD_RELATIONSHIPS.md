# Dar Tech OS — Phase 18
## ERD & Relationship Architecture
### Status: Recommended Master Data Architecture
### Date: 2026-08-31

> This document defines the logical entity relationships and database boundaries for Dar Tech OS. It is not yet a physical SQL/ORM migration. Exact column types, indexes, constraints, and implementation framework are finalized in the backend design phase. Technical deployment records support releases and environments; they are not a standalone business Deployment lifecycle.

---

# 1. Core Database Principles

1. `Organization` is the top-level business boundary.
2. Identity, business, finance, product/licensing, knowledge, and integrations remain separate domains.
3. Many-to-many relationships use explicit junction entities.
4. Historical business records are preserved.
5. Important status transitions are auditable.
6. Commercial rules are policy-driven rather than hard-coded.
7. AI/MCP never bypass the same authorization boundary used by normal users.
8. External integrations do not become the source of truth for unrelated business data.
9. Project is the main operational container, but not the owner of every entity.
10. Avoid direct circular dependencies between core domains.

---

# 2. High-Level ERD

```text
ORGANIZATION
 |
 +--< DEPARTMENT
 |      |
 |      +--< TEAM
 |
 +--< EMPLOYEE
 |      |
 |      +--1 USER_ACCOUNT
 |      +--< EMPLOYEE_ROLE >-- ROLE >--< ROLE_PERMISSION >-- PERMISSION
 |      +--< SSO_IDENTITY
 |      +--< SESSION
 |      +--< EMPLOYEE_ASSET
 |      +--< PROJECT_MEMBER >-- PROJECT
 |
 +--< CUSTOMER
 |      |
 |      +--< CONTACT
 |      +--< CUSTOMER_LOCATION
 |      +--< OPPORTUNITY
 |      +--< CONTRACT
 |      +--< INVOICE
 |      +--< PAYMENT
 |      +--< TICKET
 |      +--< COMMUNICATION
 |
 +--< LEAD
 |      |
 |      +--< LEAD_CONTACT
 |      +--< LEAD_ACTIVITY
 |      +--< LEAD_SOURCE
 |      +--< OPPORTUNITY
 |
 +--< PRODUCT
        |
        +--< PLAN
        +--< FEATURE
        +--< PRODUCT_VERSION
        +--< RELEASE
        +--< LICENSE
                 |
                 +--< ACTIVATION
                 +--< ENTITLEMENT
                         |
                         +-- WARRANTY
                         +-- UPDATE_ENTITLEMENT
                         +-- SUPPORT
                         +-- FEATURE
                         +-- SUBSCRIPTION

PROJECT
 |
 +--< PROJECT_CUSTOMER >-- CUSTOMER
 +--< PROJECT_MEMBER >---- EMPLOYEE
 +--< PROJECT_PRODUCT >--- PRODUCT
 +--< PROJECT_PHASE
 |      |
 |      +--< MILESTONE
 |             |
 |             +--< TASK
 |
 +--< REQUIREMENT
 +--< CHANGE_REQUEST
 +--< BUG
 +--< TEST_CASE
 +--< TEST_RUN
 +--< TECHNICAL_DEPLOYMENT_RECORD
 +--< CONTRACT
 +--< INVOICE
 +--< EXPENSE
 +--< LICENSE
 +--< TICKET
 +--< MEETING
 +--< DOCUMENT
 +--< FILE
 +--< COMMUNICATION
 +--< FOLLOW_UP
 +--< ACTIVITY
 +--< INTEGRITY_ALERT
```

---

# 3. Organization / Identity Relationships

## Organization → Employee
- Cardinality: `1 : N`
- An organization can have many employees.
- An employee belongs to one organization in the current single-company model.

## Organization → Department
- Cardinality: `1 : N`

## Department → Team
- Cardinality: `1 : N`

## Employee → UserAccount
- Cardinality: `1 : 1`
- An employee has one primary system account.

## Employee → SSOIdentity
- Cardinality: `1 : N`
- Allows multiple provider identities in the future.

## Employee → Session
- Cardinality: `1 : N`

## Employee → Role
- Cardinality: `M : N`
- Use `EmployeeRole`.

## Role → Permission
- Cardinality: `M : N`
- Use `RolePermission`.

## Employee → Asset
- Cardinality: `M : N` over time
- Use `EmployeeAsset` so assignment history is preserved.

---

# 4. CRM Relationships

## Lead → Opportunity
- Cardinality: `1 : N`
- A lead may produce multiple opportunities over time where the business process allows it.

## Lead → Customer
- Conversion relationship, not destructive replacement.
- Lead history remains after conversion.

## Customer → Contact
- Cardinality: `1 : N`

## Customer → CustomerLocation
- Cardinality: `1 : N`

## Customer → Opportunity
- Cardinality: `1 : N`

## Customer → Project
- Cardinality: `M : N`
- Use `ProjectCustomer`.

## Contact ↔ Project
- Project-specific contact selection should be represented through an explicit relationship if required.
- Do not overwrite the customer's primary contact.

## Lead → Outreach / Activity
- Cardinality: `1 : N`

---

# 5. Commercial Relationships

## Opportunity → Quotation
- Cardinality: `1 : N`
- Multiple quotation versions/revisions can exist.

## Quotation → QuotationVersion
- Cardinality: `1 : N`

Recommended structure:

```text
Quotation
  |
  +--< QuotationVersion
```

The accepted version is explicitly identified.

## Contract ↔ Customer
- Cardinality: `M : N`
- A contract may cover multiple customers where approved by the commercial model.

## Contract ↔ Project
- Cardinality: `M : N`
- Allows a contract to cover multiple projects.

## Contract → ContractVersion
- Cardinality: `1 : N`

## Contract → CommercialBenefit
- Cardinality: `1 : N`

---

# 6. Project Relationships

## Project → Customer
- Cardinality: `M : N`
- Use `ProjectCustomer`.

Attributes may include:
- relationship type
- commercial role
- primary flag
- effective dates

## Project → Employee
- Cardinality: `M : N`
- Use `ProjectMember`.

Attributes:
- project role
- responsibilities
- start date
- end date
- active flag

## Project → Product
- Cardinality: `M : N`
- Use `ProjectProduct`.

Attributes:
- quantity / scope
- plan
- commercial configuration
- delivery status

## Project → ProjectPhase
- Cardinality: `1 : N`

## ProjectPhase → Milestone
- Cardinality: `1 : N`

## Milestone → Task
- Cardinality: `1 : N`

A task belongs to one operational project and may optionally belong to a phase and milestone depending on workflow.

---

# 7. Requirements & Scope

## Project → Requirement
- Cardinality: `1 : N`

## Requirement → RequirementVersion
- Cardinality: `1 : N`

## Project → ChangeRequest
- Cardinality: `1 : N`

## ChangeRequest → Quotation
- Cardinality: `0 : N`
- Typically one active commercial proposal, but revisions are possible.

## ChangeRequest → ApprovalRequest
- Cardinality: `1 : N` where required.

---

# 8. Task / QA Relationships

## Project → Task
- Cardinality: `1 : N`
- Tasks should have a single owner/assignee in the current model.

## Task → Watcher / Collaborator
- Cardinality: `M : N`
- Use explicit membership entities.

## Task → TaskDependency
- Cardinality: `M : N`
- Use `TaskDependency`.

## Project → Bug
- Cardinality: `1 : N`

## Bug → Task
- Cardinality: `1 : N` or `1 : 1` depending on implementation policy.
- Recommended: a bug can be linked to multiple execution tasks if remediation is complex.

## Bug ↔ JiraIssue
- External mapping, not a duplicated issue store.

## Project → TestCase
- Cardinality: `1 : N`

## TestCase → TestRun
- Cardinality: `1 : N`

## TestRun → Bug
- Cardinality: `0 : N`

---

# 9. Product / Licensing Relationships

## Product → Plan
- Cardinality: `1 : N`

## Plan ↔ Feature
- Cardinality: `M : N`
- Use `PlanFeature`.

## Product → Feature
- Cardinality: `M : N` where products expose a catalog.

## Product → ProductVersion
- Cardinality: `1 : N`

## ProductVersion → Release
- Cardinality: `1 : N`

## Product → License
- Cardinality: `1 : N`

## License → Activation
- Cardinality: `1 : N`

This explicitly supports multiple activation keys/installations.

## License → Entitlement
- Cardinality: `1 : N`

An entitlement can represent:
- warranty
- updates
- support
- feature
- subscription

## Internal License rule

For an internal project:
- `customer_id` on the license may remain null.
- The project must identify the internal ownership context.
- Customer is not required.

---

# 10. Activation / Installation

## Activation → Installation
- Cardinality: `1 : N` or `1 : 1` depending on reinstallation policy.
- Recommended logical model: one activation may have multiple installation history records.

```text
Activation
 |
 +--< InstallationHistory
```

This supports:
- reinstall
- device changes
- environment changes
- deactivation/reactivation

---

# 11. Warranty / Updates

## Activation → Warranty
- Recommended: `1 : N` over time because warranty may be renewed.

## Entitlement → Warranty
- Can be used as the commercial source of the warranty.

Recommended model:

```text
Entitlement
   |
   +-- Warranty
```

## Entitlement → UpdateEntitlement
- Independent lifecycle from Warranty.

This preserves the rule that updates and warranty may have different durations.

---

# 12. Finance Relationships

## Customer → Invoice
- Cardinality: `1 : N`

## Project → Invoice
- Cardinality: `0 : N`

## Contract → Invoice
- Cardinality: `0 : N`

## Invoice → Installment
- Cardinality: `1 : N`

## Payment → PaymentAllocation
- Cardinality: `1 : N`

## PaymentAllocation → Invoice
- Cardinality: `N : 1`

This enables:

```text
Payment $10,000
 |
 +-- Invoice A $6,000
 +-- Invoice B $4,000
```

## Installment → PaymentAllocation
- Cardinality: `1 : N`

## Project → Expense
- Cardinality: `0 : N`

## FinancialAccount → Transaction
- Cardinality: `1 : N`

## FinancialPeriod → Transaction
- Cardinality: `1 : N`

Financial periods can be closed to protect historical reporting.

---

# 13. Support Relationships

## Customer → Ticket
- Cardinality: `1 : N`

## Project → Ticket
- Cardinality: `0 : N`

## Ticket → Task
- Cardinality: `0 : N`

## Ticket → SLA
- Cardinality: `1 : 1` or resolved from policy

## Ticket → Warranty
- Cardinality: `0 : 1`

## Ticket → Activation
- Cardinality: `0 : 1` or `0 : N` depending on ticket scope.

The warranty eligibility engine uses these relationships rather than duplicating warranty data inside the ticket.

---

# 14. Communication / Meeting Relationships

## Customer → Communication
- Cardinality: `1 : N`

## Contact → Communication
- Cardinality: `0 : N`

## Project → Communication
- Cardinality: `0 : N`

## Meeting → Participant
- Cardinality: `M : N`
- Use `MeetingParticipant`.

## Meeting → Transcript
- Cardinality: `0 : N`

## Transcript → Decision
- Cardinality: `0 : N`

## Transcript → ExtractedTask
- Cardinality: `0 : N`
- AI-generated tasks must still pass the same creation policy.

---

# 15. Knowledge Relationships

## Project → Document
- Cardinality: `0 : N`

## Document → DocumentVersion
- Cardinality: `1 : N`

## Project → File
- Cardinality: `0 : N`

## Customer → File
- Cardinality: `0 : N`

## Contract → Document
- Cardinality: `0 : N`

## Invoice → Document
- Cardinality: `0 : N`

## Meeting → File
- Cardinality: `0 : N`

Files are stored separately from business records. Business records reference files/documents through relation records or scoped foreign keys.

---

# 16. Follow-up / Activity

## Customer → FollowUp
- Cardinality: `1 : N`

## Project → FollowUp
- Cardinality: `0 : N`

## FollowUp → Employee
- Cardinality: `M : N` in the current approved model.
- Use `FollowUpAssignee`.

## Entity → Activity
- Cardinality: `1 : N` polymorphic or domain-event approach.

Recommended: use a centralized activity/event model with controlled entity references instead of free-form polymorphic data wherever strong referential integrity is needed.

---

# 17. Automation

## AutomationRule → Trigger
- Rule configuration may reference event types rather than a direct FK.

## AutomationRule → Action
- One rule can contain multiple actions.

## AutomationExecution
Tracks:
- started
- completed
- failed
- retry
- error
- actor/service

---

# 18. AI / MCP Relationships

## Employee → AIConversation
- Cardinality: `1 : N`

## AIConversation → AIMessage
- Cardinality: `1 : N`

## AIConversation → AIToolExecution
- Cardinality: `0 : N`

## AITool → Permission
- Cardinality: `1 : N` or policy-based.

## MCPConnection → AITool
- Cardinality: `M : N`

## AI Tool Execution → ApprovalRequest
- Cardinality: `0 : 1`

## AI Tool Execution → AuditEvent
- Cardinality: `1 : N` where required.

Critical principle:

```text
User
 ↓
Permission
 ↓
AI Tool
 ↓
Approval
 ↓
Execution
 ↓
Audit
```

AI does not get a separate privileged database path.

---

# 19. Integration Relationships

## Organization → Integration
- Cardinality: `1 : N`

## Integration → IntegrationJob
- Cardinality: `1 : N`

## Integration → Webhook
- Cardinality: `1 : N`

## IntegrationJob → AuditEvent
- Cardinality: `1 : N` where applicable.

## External Object Mapping

For Jira and similar tools, use mapping records such as:

```text
ProjectJiraMapping
TaskJiraMapping
BugJiraMapping
```

rather than putting many provider-specific fields directly on core entities.

---

# 20. Audit Relationships

Most important entities should expose audit history through a centralized event system.

```text
Employee
Project
Customer
Contract
Invoice
Payment
License
Activation
Warranty
Ticket
Permission
Role
AI Action
Integration Action
```

all produce:

```text
AuditEvent
```

Audit records are append-oriented and should not normally be edited.

---

# 21. Versioning Strategy

Entities that need historical versions should use explicit version records.

Recommended:
- QuotationVersion
- ContractVersion
- RequirementVersion
- DocumentVersion
- CompanyKnowledgeVersion
- DecisionVersion
- PolicyVersion

Do not create uncontrolled copies of business entities.

---

# 22. Soft Delete / Archive Strategy

Default behavior:

```text
Active
 ↓
Archived
```

For sensitive entities, destructive deletion should generally be prohibited.

Examples:
- Employee
- Customer
- Project
- Invoice
- Payment
- License
- Contract
- AuditEvent

Some transient technical records may have shorter retention according to policy.

---

# 23. Organization Boundary

Even though Dar Tech currently operates as one organization, core records should carry organization context.

This enables:

```text
organization_id
```

at appropriate aggregate roots.

The current implementation remains single-company.

Future multi-company support should be possible without redesigning every relationship.

---

# 24. Avoid These Anti-Patterns

Do not create:

```text project.developer_id
project.tester_id
project.customer_id
```

because the approved business model supports multiples.

Do not create:

```text license.activation_key
```

as a single string when multiple activations are required.

Do not merge:

```text warranty_duration
update_duration
```

into one field.

Do not make:

```text employee.role
```

a single enum.

Do not make:

```text invoice.payment_id
```

the only payment relationship.

Do not store the full Jira issue as a second independent task system.

---

# 25. Aggregate Boundaries

Recommended major aggregates:

```text
IdentityAggregate
CRM CustomerAggregate
CRM LeadAggregate
Sales OpportunityAggregate
Commercial ContractAggregate
ProjectAggregate
ProductAggregate
LicenseAggregate
CustomerSuccessAggregate
FinanceInvoiceAggregate
FinancePaymentAggregate
KnowledgeDocumentAggregate
MeetingAggregate
AutomationAggregate
AIConversationAggregate
IntegrationAggregate
```

These boundaries help prevent tightly coupled code.

---

# 26. Key Cross-Domain Flow

```text
Lead
 ↓
Opportunity
 ↓
Quotation
 ↓
Contract
 ↓
Project
 ↓
ProjectProduct
 ↓
Entitlement / License
 ↓
Activation
 ↓
Warranty / Updates
 ↓
Support / FollowUp
 ↓
Renewal
 ↓
Quotation / Contract / Invoice
 ↓
Payment
```

Project does not directly own the entire lifecycle; it connects the relevant domain aggregates.

---

# 27. Recommended Database Layering

```text
Identity
CRM
Sales
Commercial
Projects
Products
Licensing
Customer Success
Finance
Knowledge
Intelligence
Integrations
Audit/Security
```

Use separate modules/schemas/namespaces at the application level even if the first deployment uses one physical database.

---

# 28. Next Step

The logical ERD is now established.

The next architecture phase should define:

1. exact entity fields
2. primary keys
3. foreign keys
4. unique constraints
5. enum/status values
6. indexes
7. timestamps
8. soft-delete fields
9. organization scoping
10. audit columns

This becomes the basis for the actual ORM/SQL schema and API contracts.
