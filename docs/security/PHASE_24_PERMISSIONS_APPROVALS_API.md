# Dar Tech OS — Phase 24
## Permission Matrix + Approval Matrix + API Contract Pack
### Status: Recommended implementation baseline
### Date: 2026-08-31

> Purpose: convert security, approval, and backend business behavior into an implementation-ready contract for Codex. This document defines who may do what, which actions require approval, and how the API should expose sensitive business actions.

---

# 1. Authorization Model

Dar Tech OS uses:

```text
Identity
+ Role
+ Permission
+ Resource
+ Scope
+ Context
+ Risk Policy
```

Do not use job title alone as authorization.

A Founder title does not automatically mean unrestricted Super Admin.

---

# 2. Permission Naming Convention

Use stable permission keys:

```text
<domain>.<resource>.<action>
```

Examples:

```text
crm.lead.read
crm.lead.create
crm.lead.update
crm.lead.archive
sales.quotation.approve
projects.project.manage
projects.task.assign
finance.invoice.read
finance.invoice.issue
finance.payment.record
finance.payment.allocate
finance.export
licensing.license.generate
licensing.license.activate
licensing.license.revoke
support.ticket.manage
knowledge.document.read_sensitive
admin.permission.manage
ai.tool.execute_sensitive
```

---

# 3. Core Actions

Standard actions where relevant:

```text
read
create
update
archive
delete
approve
reject
assign
execute
export
import
share
manage
admin
```

Delete is intentionally uncommon for historical business entities.

---

# 4. Scope Types

Recommended scope types:

```text
SELF
ASSIGNED
TEAM
DEPARTMENT
PROJECT
CUSTOMER
ORGANIZATION
EXPLICIT
```

Examples:

```text
projects.project.read + ASSIGNED
finance.invoice.read + ORGANIZATION
knowledge.document.read + PROJECT
```

---

# 5. Default Role Strategy

Use initial templates, not immutable roles.

Recommended starter roles:

- Founder / Management
- Project Manager
- Developer
- QA / Tester
- Sales / CRM
- Finance
- Operations
- License Manager
- Support
- System Administrator

Roles are customizable.

Employees can hold multiple roles.

---

# 6. CRM Permission Matrix

| Resource | Action | Recommended permission | Typical scope | Approval |
|---|---|---|---|---|
| Lead | Read | crm.lead.read | Assigned/Team/Org | No |
| Lead | Create | crm.lead.create | Org | No |
| Lead | Update | crm.lead.update | Assigned/Team | No |
| Lead | Merge | crm.lead.merge | Team/Org | Sometimes |
| Lead | Archive | crm.lead.archive | Team/Org | No |
| Customer | Read | crm.customer.read | Assigned/Team/Org | No |
| Customer | Create | crm.customer.create | Org | No |
| Customer | Update | crm.customer.update | Assigned/Team | No |
| Customer | Export | crm.customer.export | Scope-limited | Policy |
| Contact | Manage | crm.contact.manage | Customer scope | No |

Sensitive bulk export can require approval depending on scope.

---

# 7. Sales Permission Matrix

| Resource | Action | Permission | Approval |
|---|---|---|---|
| Opportunity | Create | sales.opportunity.create | No |
| Opportunity | Update | sales.opportunity.update | No |
| Opportunity | Close Lost | sales.opportunity.close_lost | No |
| Opportunity | Reopen | sales.opportunity.reopen | No/Policy |
| Quotation | Create | sales.quotation.create | No |
| Quotation | Send | sales.quotation.send | Policy |
| Quotation | Approve | sales.quotation.approve | Yes when required |
| Discount | Apply | sales.discount.apply | Threshold-based |
| Contract | Create | commercial.contract.create | No |
| Contract | Approve | commercial.contract.approve | Yes |
| Contract | Amend | commercial.contract.amend | Yes |
| Contract | Terminate | commercial.contract.terminate | High-risk approval |

---

# 8. Project Permission Matrix

| Action | Permission | Scope | Approval |
|---|---|---|---|
| Read project | projects.project.read | Assigned/Team/Org | No |
| Create project | projects.project.create | Org | Policy |
| Update project | projects.project.update | Assigned/Team | No |
| Manage members | projects.member.manage | Project | Policy |
| Manage requirements | projects.requirement.manage | Project | No |
| Approve requirement | projects.requirement.approve | Project | Policy |
| Manage scope | projects.scope.manage | Project | No |
| Submit CR | projects.change_request.submit | Project | No |
| Approve CR | projects.change_request.approve | Project | Yes |
| Deliver project | projects.project.deliver | Project | Gate/policy |
| Override delivery gate | projects.delivery.override | Project | Yes |
| Archive project | projects.project.archive | Project/Org | Policy |

---

# 9. Task / QA Permission Matrix

| Action | Permission | Approval |
|---|---|---|
| Create task | projects.task.create | No |
| Assign task | projects.task.assign | No |
| Update task | projects.task.update | No |
| Close task | projects.task.complete | No |
| Create bug | qa.bug.create | No |
| Triage bug | qa.bug.triage | No |
| Resolve bug | qa.bug.resolve | No |
| Override critical bug gate | qa.delivery.override | Yes |
| Execute test | qa.test.execute | No |
| Approve QA completion | qa.test.approve | Policy |

---

# 10. Finance Permission Matrix

Finance permissions must be granular.

| Action | Permission | Approval |
|---|---|---|
| Read invoices | finance.invoice.read | No |
| Create invoice | finance.invoice.create | No/Policy |
| Issue invoice | finance.invoice.issue | Policy |
| Void invoice | finance.invoice.void | Yes |
| Read payments | finance.payment.read | No |
| Record payment | finance.payment.record | No/Policy |
| Allocate payment | finance.payment.allocate | No/Policy |
| Edit material payment | finance.payment.adjust | Yes |
| Refund | finance.refund.create | Threshold-based |
| Credit note | finance.credit.create | Threshold-based |
| Record expense | finance.expense.create | No/Policy |
| Approve expense | finance.expense.approve | Threshold-based |
| Reconcile | finance.reconciliation.manage | Finance-only |
| Close financial period | finance.period.close | Yes |
| Reopen financial period | finance.period.reopen | Critical approval |
| Export finance | finance.export | Sensitive policy |
| View profitability | finance.profitability.read | Restricted |

---

# 11. Licensing Permission Matrix

| Action | Permission | Risk | Approval |
|---|---|---|---|
| Read license | licensing.license.read | Low | No |
| Generate license | licensing.license.generate | Medium | Policy |
| Generate activation key | licensing.activation_key.generate | Medium | Policy |
| Activate license | licensing.license.activate | Medium | Policy |
| Suspend license | licensing.license.suspend | High | Yes/Policy |
| Revoke license | licensing.license.revoke | Critical | Yes + step-up |
| Reactivate license | licensing.license.reactivate | High | Yes |
| Modify entitlement | licensing.entitlement.update | High | Policy/Approval |
| Extend warranty | licensing.warranty.extend | High | Approval |
| Extend updates | licensing.updates.extend | High | Approval |

---

# 12. Support Permission Matrix

| Action | Permission | Approval |
|---|---|---|
| Read tickets | support.ticket.read | No |
| Create ticket | support.ticket.create | No |
| Assign ticket | support.ticket.assign | No |
| Resolve ticket | support.ticket.resolve | No |
| Override warranty eligibility | support.warranty.override | Yes |
| Override SLA | support.sla.override | Policy |
| Close ticket | support.ticket.close | No/Policy |

---

# 13. Knowledge / Files Permissions

| Action | Permission | Notes |
|---|---|---|
| Read file | knowledge.file.read | Scope + sensitivity |
| Upload file | knowledge.file.upload | Scope-aware |
| Share secure link | knowledge.file.share | Policy |
| Read sensitive doc | knowledge.document.read_sensitive | Explicit permission |
| Export document | knowledge.document.export | Sensitive policy |
| Approve knowledge | knowledge.page.approve | Approval role |
| Manage Company Memory | knowledge.memory.manage | Restricted |

---

# 14. Identity / Admin Permissions

| Action | Permission | Approval |
|---|---|---|
| Invite employee | admin.employee.invite | No/Policy |
| Suspend employee | admin.employee.suspend | Policy |
| Offboard employee | admin.employee.offboard | Yes |
| Assign role | admin.role.assign | Policy |
| Create role | admin.role.create | Restricted |
| Change permission | admin.permission.manage | Critical |
| Create temporary access | admin.access.temporary | Approval |
| Emergency access | admin.access.emergency | Critical + step-up |
| Revoke session | admin.session.revoke | No/Policy |
| Configure SSO | admin.sso.manage | Critical |

---

# 15. Integration Permissions

Each integration gets separate scopes.

Examples:

```text
integration.jira.read
integration.jira.write
integration.slack.send
integration.slack.command
integration.google_drive.read
integration.google_drive.write
integration.google_calendar.write
integration.hostinger.read
integration.hostinger.deploy
integration.n8n.execute
```

External provider permissions must not bypass Dar Tech permissions.

---

# 16. AI / MCP Permissions

AI tool execution requires both:

```text
User permission
AND
Tool permission/policy
```

Examples:

```text
ai.search.execute
ai.task.create
ai.followup.create
ai.invoice.create
ai.license.revoke
mcp.connect
mcp.tool.execute
```

Critical tools require approval and full audit.

---

# 17. Risk Levels

Recommended action risk model:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

### Low
Read/search routine data.

### Medium
Create/update non-sensitive operational data.

### High
Financial, contractual, entitlement, access-impacting operations.

### Critical
Permissions, emergency access, license revocation, sensitive finance export, financial-period reversal.

---

# 18. Approval Policy Engine

Approval should be policy-driven.

Policy inputs:

```text
Action
Resource
Amount/value
Risk
Actor role
Scope
Customer/project context
Environment
```

Policy outputs:

```text
NO_APPROVAL
SINGLE_APPROVER
SEQUENTIAL_APPROVAL
PARALLEL_APPROVAL
STEP_UP_ONLY
STEP_UP_AND_APPROVAL
```

---

# 19. Approval Matrix — Commercial

| Action | Default policy |
|---|---|
| Send standard quotation | No approval or optional internal review |
| Discount under threshold | No approval |
| Discount over threshold | Approval |
| Special free benefit | Approval |
| Contract approval | Approval |
| Contract amendment | Approval |
| Contract termination | High-risk approval |

Exact financial thresholds remain configurable and require final business validation.

---

# 20. Approval Matrix — Finance

| Action | Default policy |
|---|---|
| Record normal payment | No approval or finance policy |
| Refund | Amount/risk-based approval |
| Credit note | Amount/risk-based approval |
| Material adjustment | Approval |
| Void issued invoice | Approval |
| Close financial period | Approval |
| Reopen closed period | Critical multi-level approval |
| Bulk finance export | Sensitive-data approval/policy |

---

# 21. Approval Matrix — Licensing

| Action | Default policy |
|---|---|
| Generate standard license | Permission-based |
| Activate standard license | Permission/policy |
| Extend warranty manually | Approval |
| Change entitlement | Approval |
| Suspend license | Approval depending on context |
| Revoke license | Step-up + approval |
| Reactivate revoked license | Approval |

---

# 22. Approval Matrix — Identity/Security

| Action | Default policy |
|---|---|
| Add role | Policy |
| Modify core role permissions | Critical approval |
| Temporary elevated access | Approval + expiry |
| Emergency access | Step-up + approval/reason |
| Configure SSO | Critical approval |
| Disable founder/management account | Critical policy |

---

# 23. API Design Rules

1. Version all APIs.
2. Server-side authorization on every protected endpoint.
3. Commands for meaningful state transitions.
4. Stable error codes.
5. Idempotency for duplicate-sensitive operations.
6. Request IDs on all responses.
7. Audit high-risk mutations.
8. Publish domain events for meaningful transitions.
9. Never expose internal secrets or stack traces.
10. OpenAPI documentation generated and kept current.

---

# 24. Standard API Envelope

Success:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_123"
  }
}
```

Error:

```json
{
  "error": {
    "code": "PROJECT_DELIVERY_BLOCKED",
    "message": "Project delivery requirements are not satisfied.",
    "requestId": "req_123"
  }
}
```

---

# 25. Pagination Contract

Recommended list query:

```text
?page=1&pageSize=50&sort=createdAt:desc
```

Response metadata:

```json
{
  "page": 1,
  "pageSize": 50,
  "total": 200
}
```

Cursor pagination may later be used for high-volume activity/event feeds.

---

# 26. Filter Contract

Use explicit query params for common fields.

Example:

```text
GET /api/v1/projects?status=IN_PROGRESS&customerId=...&ownerId=...
```

Complex saved-view filters may use structured filter objects internally.

---

# 27. CRM API Contract

## Leads

```text
GET    /api/v1/leads
POST   /api/v1/leads
GET    /api/v1/leads/:id
PATCH  /api/v1/leads/:id
POST   /api/v1/leads/:id/archive
POST   /api/v1/leads/:id/reactivate
POST   /api/v1/leads/:id/merge
POST   /api/v1/leads/:id/activities
POST   /api/v1/leads/:id/convert
```

## Customers

```text
GET    /api/v1/customers
POST   /api/v1/customers
GET    /api/v1/customers/:id
PATCH  /api/v1/customers/:id
GET    /api/v1/customers/:id/360
POST   /api/v1/customers/:id/contacts
POST   /api/v1/customers/:id/locations
POST   /api/v1/customers/:id/archive
```

---

# 28. Sales API Contract

```text
GET    /api/v1/opportunities
POST   /api/v1/opportunities
GET    /api/v1/opportunities/:id
PATCH  /api/v1/opportunities/:id
POST   /api/v1/opportunities/:id/reopen
POST   /api/v1/opportunities/:id/close-won
POST   /api/v1/opportunities/:id/close-lost

GET    /api/v1/quotations
POST   /api/v1/quotations
GET    /api/v1/quotations/:id
POST   /api/v1/quotations/:id/versions
POST   /api/v1/quotations/:id/send
POST   /api/v1/quotations/:id/approve
POST   /api/v1/quotations/:id/reject
POST   /api/v1/quotations/:id/accept
```

---

# 29. Contract API Contract

```text
GET    /api/v1/contracts
POST   /api/v1/contracts
GET    /api/v1/contracts/:id
PATCH  /api/v1/contracts/:id
POST   /api/v1/contracts/:id/submit-review
POST   /api/v1/contracts/:id/approve
POST   /api/v1/contracts/:id/sign
POST   /api/v1/contracts/:id/amend
POST   /api/v1/contracts/:id/terminate
POST   /api/v1/contracts/:id/archive
```

---

# 30. Project API Contract

```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
POST   /api/v1/projects/:id/members
POST   /api/v1/projects/:id/customers
POST   /api/v1/projects/:id/products
POST   /api/v1/projects/:id/phases
POST   /api/v1/projects/:id/milestones
POST   /api/v1/projects/:id/requirements
POST   /api/v1/projects/:id/change-requests
POST   /api/v1/projects/:id/deliver
POST   /api/v1/projects/:id/override-delivery
POST   /api/v1/projects/:id/complete
POST   /api/v1/projects/:id/archive
GET    /api/v1/projects/:id/intelligence
```

---

# 31. Task / QA API Contract

```text
GET    /api/v1/tasks
POST   /api/v1/tasks
GET    /api/v1/tasks/:id
PATCH  /api/v1/tasks/:id
POST   /api/v1/tasks/:id/assign
POST   /api/v1/tasks/:id/block
POST   /api/v1/tasks/:id/complete
POST   /api/v1/tasks/:id/comments

POST   /api/v1/test-cases
POST   /api/v1/test-runs
POST   /api/v1/bugs
POST   /api/v1/bugs/:id/triage
POST   /api/v1/bugs/:id/resolve
POST   /api/v1/bugs/:id/reopen
```

---

# 32. Product / Licensing API Contract

```text
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:id
POST   /api/v1/products/:id/plans
POST   /api/v1/products/:id/features
POST   /api/v1/products/:id/versions
POST   /api/v1/products/:id/releases

GET    /api/v1/licenses
POST   /api/v1/licenses
GET    /api/v1/licenses/:id
POST   /api/v1/licenses/:id/generate-key
POST   /api/v1/licenses/:id/activate
POST   /api/v1/licenses/:id/suspend
POST   /api/v1/licenses/:id/revoke
POST   /api/v1/licenses/:id/reactivate
POST   /api/v1/licenses/:id/entitlements
```

High-risk licensing endpoints must enforce approval policy.

---

# 33. Warranty / Support API Contract

```text
GET    /api/v1/warranties
GET    /api/v1/warranties/:id
POST   /api/v1/warranties/:id/renew
POST   /api/v1/warranties/:id/extend

GET    /api/v1/tickets
POST   /api/v1/tickets
GET    /api/v1/tickets/:id
PATCH  /api/v1/tickets/:id
POST   /api/v1/tickets/:id/assign
POST   /api/v1/tickets/:id/resolve
POST   /api/v1/tickets/:id/close
POST   /api/v1/tickets/:id/reopen
POST   /api/v1/tickets/:id/override-warranty
```

---

# 34. Finance API Contract

```text
GET    /api/v1/invoices
POST   /api/v1/invoices
GET    /api/v1/invoices/:id
PATCH  /api/v1/invoices/:id
POST   /api/v1/invoices/:id/issue
POST   /api/v1/invoices/:id/void
POST   /api/v1/invoices/:id/adjustments

GET    /api/v1/payments
POST   /api/v1/payments
GET    /api/v1/payments/:id
POST   /api/v1/payments/:id/allocate
POST   /api/v1/payments/:id/refund

GET    /api/v1/expenses
POST   /api/v1/expenses
POST   /api/v1/expenses/:id/approve

GET    /api/v1/finance/upcoming-money
GET    /api/v1/finance/profitability
GET    /api/v1/finance/reconciliation
POST   /api/v1/finance/periods/:id/close
POST   /api/v1/finance/periods/:id/reopen
```

---

# 35. Employee / Admin API Contract

```text
GET    /api/v1/employees
POST   /api/v1/employees/invite
GET    /api/v1/employees/:id
PATCH  /api/v1/employees/:id
POST   /api/v1/employees/:id/suspend
POST   /api/v1/employees/:id/offboard
POST   /api/v1/employees/:id/roles
POST   /api/v1/employees/:id/temporary-access

GET    /api/v1/roles
POST   /api/v1/roles
PATCH  /api/v1/roles/:id
GET    /api/v1/permissions
POST   /api/v1/roles/:id/permissions
```

---

# 36. Approval API Contract

```text
GET    /api/v1/approvals
GET    /api/v1/approvals/:id
POST   /api/v1/approvals/:id/approve
POST   /api/v1/approvals/:id/reject
POST   /api/v1/approvals/:id/request-changes
```

Approval details should expose:
- requested action
- actor
- target
- reason
- risk
- steps
- current approver
- audit history

---

# 37. Knowledge / File API Contract

```text
POST   /api/v1/files/upload
GET    /api/v1/files/:id
POST   /api/v1/files/:id/share-link
POST   /api/v1/files/:id/archive

GET    /api/v1/documents/:id
POST   /api/v1/documents/:id/versions
POST   /api/v1/documents/:id/approve

GET    /api/v1/knowledge/search
GET    /api/v1/knowledge/pages
POST   /api/v1/knowledge/pages
POST   /api/v1/knowledge/pages/:id/versions
```

---

# 38. Meetings / Transcript API Contract

```text
GET    /api/v1/meetings
POST   /api/v1/meetings
GET    /api/v1/meetings/:id
POST   /api/v1/meetings/:id/audio
POST   /api/v1/meetings/:id/transcribe
GET    /api/v1/meetings/:id/transcript
POST   /api/v1/meetings/:id/extract-actions
```

AI-extracted actions remain suggestions until execution policy allows creation.

---

# 39. Intelligence API Contract

```text
GET /api/v1/command-center
GET /api/v1/intelligence/projects/:id
GET /api/v1/intelligence/customers/:id
GET /api/v1/intelligence/leads
GET /api/v1/intelligence/finance
GET /api/v1/intelligence/team
GET /api/v1/intelligence/alerts
GET /api/v1/intelligence/kpis
POST /api/v1/intelligence/saved-views
```

Every intelligence response should classify metrics as:

```text
OBSERVED
CALCULATED
ESTIMATED
FORECAST
AI_INTERPRETATION
```

---

# 40. Integration API Contract

```text
GET    /api/v1/integrations
POST   /api/v1/integrations/:provider/connect
POST   /api/v1/integrations/:provider/disconnect
GET    /api/v1/integrations/:provider/health
GET    /api/v1/integrations/:provider/scopes
PATCH  /api/v1/integrations/:provider/scopes
GET    /api/v1/integration-jobs
POST   /api/v1/integration-jobs/:id/retry
```

Provider-specific API routes should be minimal and capability-driven.

---

# 41. AI / MCP API Contract

```text
POST /api/v1/ai/conversations
POST /api/v1/ai/conversations/:id/messages
POST /api/v1/ai/tools/:toolKey/execute
GET  /api/v1/ai/tools

GET  /api/v1/mcp/connections
POST /api/v1/mcp/connections
PATCH /api/v1/mcp/connections/:id
```

Sensitive AI tools must never bypass approval policies.

---

# 42. Idempotency Contract

Require `Idempotency-Key` for:
- payment creation
- payment allocation
- license generation
- license activation
- license revocation requests
- refund/adjustment requests
- external webhook handling

Duplicate requests with the same key should return the original result when safe.

---

# 43. Audit Contract

High-value mutations create an audit event.

At minimum:

```text
actor
request_id
action
entity_type
entity_id
old_state/new_state
reason
approval_reference
created_at
```

---

# 44. State Transition Contract

Critical entities must use explicit transition endpoints/services rather than arbitrary status patches.

Applies to:
- projects
- quotations
- contracts
- licenses
- warranty
- tickets
- invoices
- payments
- employees
- approvals
- integration jobs

---

# 45. Codex Implementation Contract

For every endpoint, Codex must implement:

```text
Route
DTO
Validation
Authentication
Authorization
Use Case
Repository
Transaction where needed
Domain Event
Audit
Tests
OpenAPI
```

No endpoint is considered complete if authorization or tests are missing.

---

# 46. Required Test Coverage

Permission tests must include:
- allowed action
- denied action
- wrong scope
- removed role
- temporary permission expiry
- emergency access
- AI/MCP user boundary

Approval tests must include:
- no-approval path
- approval-required path
- rejection
- multi-step approval
- approval expiry/cancellation if implemented
- execution failure after approval

API tests must include:
- validation
- authorization
- idempotency
- error contract
- concurrency conflict
- audit event
- state transition

---

# 47. Open Items That Require Business Validation

Do not hard-code these yet:

1. Exact discount approval thresholds.
2. Exact expense/refund approval thresholds.
3. Founder-specific approval rules.
4. Exact contract-signature approval chain.
5. Exact production deployment approval policy.
6. Exact bulk export limits.
7. Exact license-revocation approval chain for different product types.
8. Exact warranty-extension approval thresholds.

These belong in configurable policy data or future ADRs.

---

# 48. Phase 24 Exit Criteria

Phase 24 is complete when:
- permission naming standard is defined;
- scope model is defined;
- core role templates are defined;
- domain permission matrices exist;
- risk levels exist;
- approval policy outputs exist;
- commercial/finance/licensing/security approval matrices exist;
- versioned API conventions exist;
- core endpoint map exists;
- idempotency/audit/state-transition contracts exist;
- Codex implementation checklist exists;
- unresolved thresholds are explicitly marked for validation.

Next recommended phase:
**Phase 25 — Event Catalog + Notification Matrix + MCP Tool Catalog**, followed by the final Codex execution backlog.
