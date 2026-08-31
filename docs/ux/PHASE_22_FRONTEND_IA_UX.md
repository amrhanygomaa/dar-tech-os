# Dar Tech OS — Phase 22
## Frontend Information Architecture & UX Specification
### Status: Recommended implementation baseline
### Date: 2026-08-31

## 1. UX Goal

Dar Tech OS should feel like one professional internal operating system, not a collection of disconnected admin pages and not an AI-chat interface.

Primary UX principles:
- information hierarchy first
- actions close to the relevant data
- global search always accessible
- predictable navigation
- dense enough for operations without becoming cluttered
- responsive on laptop and mobile browser
- permissions reflected in navigation and actions
- every important record has a timeline/context view
- progressive disclosure for advanced information

---

# 2. Global Application Shell

Recommended shell:

```text
┌─────────────────────────────────────────────────────────────────┐
│ Top Bar                                                         │
│ Search | Quick Create | Notifications | AI | User              │
├───────────────┬─────────────────────────────────────────────────┤
│ Sidebar       │ Page Header                                    │
│               │                                                 │
│ Command       │ Content                                         │
│ CRM           │                                                 │
│ Sales         │                                                 │
│ Projects      │                                                 │
│ Finance       │                                                 │
│ Products      │                                                 │
│ Licensing     │                                                 │
│ Support       │                                                 │
│ Knowledge     │                                                 │
│ Intelligence │                                                 │
│ Integrations  │                                                 │
│ Admin         │                                                 │
└───────────────┴─────────────────────────────────────────────────┘
```

The visible navigation is permission-aware.

---

# 3. Primary Navigation

Recommended order:

1. Command Center
2. CRM
3. Sales
4. Projects
5. Products
6. Licensing
7. Customer Success
8. Finance
9. Knowledge
10. Intelligence / Reports
11. Integrations
12. Admin

Do not expose every submodule permanently in the sidebar.

Use expandable groups.

---

# 4. Top Bar

Persistent controls:
- global search
- quick create
- notifications
- approval inbox
- AI assistant
- user/account menu

Global search should support keyboard access.

---

# 5. Quick Create

One universal quick-create action:

```text
Create
├── Lead
├── Customer
├── Opportunity
├── Quotation
├── Contract
├── Project
├── Task
├── Ticket
├── Invoice
├── Payment
├── Follow-up
├── Meeting
└── Note
```

The list must be permission-aware.

---

# 6. Command Center

Default landing page after login.

Sections:

```text
Today
├── Critical Alerts
├── My Approvals
├── Follow-ups Due
├── Project Risks
├── Finance Attention
├── Renewals
└── Integration Problems
```

Then role-aware KPI cards and trend widgets.

Users should be able to reorder/hide widgets where permitted.

---

# 7. List Page Standard

Every major list follows the same structure:

```text
Page Title
[Search] [Filters] [Saved View] [Create]

Table / Cards

Pagination
```

Table capabilities:
- sorting
- filtering
- column selection
- saved views
- bulk selection
- export if permitted
- row actions

Avoid putting 20 filters visibly on screen; advanced filters belong in a filter drawer.

---

# 8. Detail Page Standard

Recommended record layout:

```text
Header
├── Name / Status
├── Primary action
├── More actions
└── Key metadata

Tabs / Sections
├── Overview
├── Activity
├── Related
├── Documents
└── Intelligence
```

Specific modules add domain tabs.

---

# 9. Customer 360

Customer detail should be a high-value workspace.

```text
Customer Header
├── Name
├── Industry / Business Type
├── Location
├── Health
└── Primary Contacts

Overview
├── Active Projects
├── Outstanding Finance
├── Licenses
├── Warranty
├── Renewals
└── Recent Activity

Tabs
├── Contacts
├── Leads / Opportunities
├── Projects
├── Contracts
├── Quotations
├── Finance
├── Licenses
├── Warranty / Updates
├── Tickets
├── Communications
├── Files
└── Activity
```

---

# 10. Project Workspace

Project should use a workspace rather than a long generic detail page.

```text
Project Header
├── Status
├── Health
├── Delivery Date
├── Customer(s)
├── Team
└── Primary Actions

Tabs
├── Overview
├── Requirements
├── Scope
├── Phases
├── Milestones
├── Tasks
├── Jira
├── QA
├── Bugs
├── Delivery
├── Releases / Environments
├── Products
├── Licenses
├── Warranty
├── Finance
├── Support
├── Files
├── Meetings
├── Activity
└── Intelligence
```

The default Overview should answer:

> Where is this project now, what is blocking it, and what happens next?

---

# 11. Project Overview

Recommended blocks:

```text
Health
Timeline
Milestones
Current Phase
Blocked Work
Critical Bugs
Commercial Summary
Customer Attention
Recent Activity
Next Actions
```

Avoid making the user open five tabs to discover project risk.

---

# 12. Lead Workspace

Lead detail:

```text
Lead Header
├── Company
├── Business Type
├── Industry
├── Location
├── Score
├── Priority
└── Owner

Tabs
├── Overview
├── Research
├── Contacts
├── Outreach
├── Opportunities
├── Notes
├── Files
└── Activity
```

Research should display source/provenance for important facts.

---

# 13. Opportunity Workspace

```text
Overview
Pipeline Stage
Value
Probability
Expected Close
Owner
Contacts
Activities
Quotation
Commercial History
```

A visible next-step field should be present.

---

# 14. Quotation Workspace

Important UI:

```text
Quotation
├── Status
├── Customer
├── Project
├── Total
├── Currency
└── Validity

Version History
Line Items
Discounts
Taxes
Approvals
Documents
Negotiation History
```

Users should be able to compare versions.

---

# 15. Contract Workspace

```text
Contract
├── Status
├── Customer(s)
├── Project(s)
├── Dates
└── Expiry

Terms
Versions
Benefits
Documents
Signatures
Approvals
Audit
```

Expiry should be visually prominent without using alarming styling for normal states.

---

# 16. Licensing Workspace

```text
Product
License
├── Status
├── Entitlements
├── Activation Keys
├── Activations
├── Installations
├── Warranty
├── Updates
├── Releases
└── History
```

High-risk actions such as revoke should be separated from routine actions and visibly indicate policy/approval requirements.

---

# 17. Finance Workspace

Finance homepage:

```text
Cash / Accounts
Upcoming Money
Outstanding
Overdue
Revenue
Expenses
Profitability
Reconciliation
```

Invoice detail:

```text
Invoice
├── Summary
├── Items
├── Installments
├── Payments
├── Allocations
├── Documents
├── Adjustments
└── Audit
```

Finance UI should remain dense and efficient while protecting sensitive information.

---

# 18. Support Workspace

```text
Tickets
├── All
├── My Tickets
├── SLA Risk
├── Warranty
├── Out of Warranty
└── Escalated
```

Ticket detail prominently shows:
- customer
- project/product
- warranty eligibility
- SLA timer/state
- assignee
- linked tasks
- communication
- resolution

---

# 19. Employee Workspace

```text
Employee Header
├── Identity
├── Position
├── Status
└── Department

Tabs
├── Overview
├── Roles
├── Permissions
├── Projects
├── Tasks
├── Skills
├── Workload
├── Assets
├── Activity
└── Security
```

Sensitive employee fields should use restricted sections and permissions.

---

# 20. Knowledge Workspace

```text
Knowledge
├── Company
├── Policies
├── SOPs
├── Technical
├── Sales
├── Finance
├── Projects
└── Decisions
```

Search should be the primary interaction rather than deep folder drilling.

---

# 21. AI Assistant UX

AI should be accessible globally but not dominate the application.

Recommended:

```text
Top bar → AI button

Click
↓
Side panel / command interface
```

It should support:
- natural language questions
- record-aware questions
- source references
- suggested actions
- explicit action execution

Example:

> Which projects need attention today?

Result:
- project
- reason
- evidence
- recommended action

---

# 22. AI Action Confirmation

Before sensitive actions, show:

```text
Action
Target
Reason
Changes
Risk
Approval Required

[Cancel] [Request Approval]
```

The UI must never make a sensitive AI action appear identical to a normal read operation.

---

# 23. Global Search UX

Search should support:

```text
Search everything...

Customers
Projects
Leads
Invoices
Licenses
Files
Tasks
Tickets
Knowledge
```

Suggested sections:
- exact matches
- recent records
- semantic results
- related records

Every result respects authorization.

---

# 24. Mobile UX

Mobile is a first-class responsive experience, not a shrunk desktop interface.

On mobile:
- sidebar becomes navigation drawer
- tables become responsive lists/cards where needed
- primary action remains reachable
- critical information moves above the fold
- large multi-column dashboards stack vertically
- complex filters use drawers
- detail tabs become horizontally scrollable or segmented navigation

Do not require horizontal scrolling for routine actions.

---

# 25. Responsive Priorities

### Mobile priority
1. Alerts
2. Tasks
3. Follow-ups
4. Customer/project summary
5. Approvals
6. Quick actions

### Desktop priority
1. Command Center
2. tables
3. multi-column workspaces
4. analytics
5. side-by-side records

---

# 26. Forms

Forms should:
- group related fields
- show required vs optional clearly
- preserve unsaved state warnings
- validate inline
- display server validation errors
- support draft states where business workflow requires them
- avoid unnecessarily long single-page forms

Use multi-step forms for complex entities such as Projects, Contracts, and onboarding.

---

# 27. Tables

Tables must support:
- pagination
- sorting
- filters
- column visibility
- sticky key columns where appropriate
- row-level actions
- bulk actions
- saved views

Bulk actions must perform authorization checks per record where necessary.

---

# 28. Activity Timeline

Major records should have a consistent activity timeline:

```text
Created
Status Changed
Comment Added
File Uploaded
Payment Recorded
Approval Requested
Approval Completed
Jira Synced
AI Action
```

The timeline should distinguish human activity from automation and AI.

---

# 29. Status Visualization

Use text labels plus restrained visual indicators.

Do not rely on color alone.

Examples:

```text
Healthy
At Risk
Critical
Pending
Approved
Rejected
Expired
Archived
```

Color is supplementary, not the only semantic channel.

---

# 30. Notifications Center

A central inbox should group:

```text
Mentions
Approvals
Tasks
Follow-ups
Finance
Renewals
Projects
Security
Integrations
```

Users can mark read/unread and navigate directly to the source record.

---

# 31. Admin UX

Admin Console:

```text
Organization
Employees
Teams
Roles
Permissions
Approvals
Workflows
Notifications
Integrations
AI
MCP
Security
Audit
System Health
```

Separate dangerous settings from routine configuration.

---

# 32. Navigation Principle

The UI should make these relationships discoverable:

```text
Customer ↔ Project
Project ↔ Contract
Project ↔ Invoice
Project ↔ License
License ↔ Activation
Activation ↔ Warranty
Warranty ↔ Ticket
Ticket ↔ Task
Task ↔ Jira
Meeting ↔ Transcript
Transcript ↔ Decisions/Tasks
```

Every related record should be clickable where permissions allow.

---

# 33. Design System

Build a reusable internal design system from the beginning.

Core primitives:
- Button
- Input
- Select
- Combobox
- Date picker
- Status badge
- Data table
- Drawer
- Dialog
- Tabs
- Timeline
- Card
- Empty state
- Skeleton
- Toast
- Tooltip
- Command palette

Do not duplicate one-off UI patterns in every module.

---

# 34. Empty States

Empty states should explain what to do next.

Example:

```text
No Projects yet

Create your first project or import projects from your existing data.

[Create Project]
```

Avoid decorative empty pages.

---

# 35. Loading / Error States

Every async screen must define:
- loading
- empty
- success
- partial failure
- permission denied
- validation error
- integration failure

Do not show blank white screens when data fails.

---

# 36. Accessibility Baseline

Target:
- keyboard navigation
- visible focus
- semantic controls
- adequate text contrast
- status not communicated by color alone
- accessible labels
- logical heading order
- responsive text sizing

Use the design system to enforce consistency.

---

# 37. UX Rule for Permissions

The frontend may hide unavailable actions for clarity, but backend authorization remains authoritative.

Therefore:

```text
Hidden button
≠
Security boundary
```

Unauthorized direct API access must still be rejected.

---

# 38. UX Rule for High-Risk Actions

For destructive/financial/licensing/security actions:

```text
Action
→ Explain impact
→ Confirmation
→ Approval/Step-up when required
→ Execute
→ Result
→ Audit reference
```

Examples:
- revoke license
- void invoice
- adjust payment
- change permissions
- emergency access

---

# 39. Recommended Frontend Build Order

1. App shell + design system
2. Authentication/SSO screens
3. Command Center
4. CRM / Customer / Lead
5. Sales / Commercial
6. Project workspace
7. Finance
8. Product/Licensing
9. Support
10. Knowledge/Meetings
11. Admin/Security
12. Intelligence/Reports
13. AI/MCP UX
14. Integrations

Build reusable primitives before multiplying page-specific components.

---

# 40. Frontend Definition of Done

A frontend feature is complete when:
- responsive desktop/mobile behavior exists
- permissions are reflected
- loading/error/empty states exist
- accessibility baseline is met
- server errors are handled
- state transitions are clear
- destructive actions are protected
- audit/approval states are visible where relevant
- tests are present where practical
- no duplicated bespoke component replaces an existing design-system primitive

---

# 41. Phase 22 Exit Criteria

The frontend architecture is ready for implementation when:
- navigation is defined
- major workspaces are defined
- responsive behavior is defined
- design-system primitives are defined
- Customer 360 is defined
- Project Workspace is defined
- Employee Workspace is defined
- AI interaction model is defined
- permission-aware UX is defined
- empty/loading/error patterns are defined
- frontend build order is defined

Next:
**Phase 23 — Master PRD + Codex Build Package**, where all approved requirements are converted into implementation epics, module tickets, acceptance criteria, and a controlled execution order.
