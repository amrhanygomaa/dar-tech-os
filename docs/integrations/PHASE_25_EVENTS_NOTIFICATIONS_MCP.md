# Dar Tech OS — Phase 25
## Event Catalog, Notification Matrix & MCP/AI Tool Catalog
### Status: Recommended implementation baseline
### Date: 2026-08-31

> Purpose: define the event-driven contracts, notification behavior, and permission-aware AI/MCP tool surface that Codex must implement without inventing side effects or security rules.

---

# 1. Core Event Architecture

Dar Tech OS uses business events as reliable signals that something meaningful already happened.

```text
Command
→ Validation
→ Authorization
→ Approval (if required)
→ Database Transaction
   ├── Business State Change
   ├── Audit Event
   └── Outbox Event
→ Response

Outbox Worker
→ Event Bus
→ Subscribers
→ Notifications / Integrations / Analytics / AI
```

Rules:
1. Business events use past tense.
2. Events do not replace the source-of-truth database record.
3. Critical events are written to the outbox in the same transaction as the business mutation.
4. Consumers must be idempotent.
5. Provider failures must not silently roll back an already-completed business action unless the provider call is part of the required atomic domain operation.
6. Event payloads should be versioned when schemas change materially.

Recommended envelope:

```json
{
  "eventId": "uuid",
  "eventType": "LicenseActivated.v1",
  "occurredAt": "UTC timestamp",
  "organizationId": "uuid",
  "actor": {
    "type": "EMPLOYEE|SYSTEM|AI|INTEGRATION",
    "id": "uuid|null"
  },
  "entity": {
    "type": "LICENSE",
    "id": "uuid"
  },
  "correlationId": "uuid",
  "causationId": "uuid|null",
  "payload": {}
}
```

---

# 2. CRM Event Catalog

## LeadCreated
Subscribers:
- activity timeline
- lead scoring initialization
- optional assignment automation
- analytics

Notifications:
- owner, if assigned

## LeadUpdated
Subscribers:
- data-quality checks
- score recalculation where relevant
- activity timeline

## LeadQualified
Subscribers:
- opportunity suggestion/creation policy
- sales analytics
- follow-up policy

Notifications:
- lead owner
- sales collaborators where configured

## LeadDisqualified
Subscribers:
- pipeline analytics
- nurture/closure automation

## LeadReactivated
Subscribers:
- activity timeline
- follow-up queue
- scoring refresh

## LeadConvertedToCustomer
Subscribers:
- preserve lead history
- customer timeline
- attribution analytics

## OpportunityCreated
Subscribers:
- pipeline metrics
- activity timeline

## OpportunityStageChanged
Subscribers:
- weighted forecast refresh
- stage-age analytics
- automation rules

## OpportunityWon
Subscribers:
- commercial/project creation policy
- sales metrics
- commission workflow where configured

Notifications:
- owner
- relevant management roles

## OpportunityLost
Subscribers:
- lost-reason analytics
- forecasting refresh
- nurture rule if configured

---

# 3. Commercial Event Catalog

## QuotationCreated
Subscribers:
- commercial timeline

## QuotationSubmittedForReview
Subscribers:
- approval engine

Notifications:
- required approver(s)

## QuotationApproved
Subscribers:
- send/issue eligibility

## QuotationSent
Subscribers:
- communication timeline
- follow-up scheduler

## QuotationViewed
Subscribers:
- sales activity
- optional owner notification

## QuotationAccepted
Subscribers:
- contract/project creation policy
- opportunity state update
- commercial analytics

Notifications:
- owner
- project/commercial responsible roles

## QuotationRejected
Subscribers:
- opportunity/commercial timeline

## QuotationExpired
Subscribers:
- follow-up suggestion
- pipeline risk signal

## ContractApproved
Subscribers:
- signing/sending workflow

## ContractSigned
Subscribers:
- project/commercial activation policy
- contract expiry scheduler
- document timeline

Notifications:
- project/commercial owner

## ContractExpiringSoon
Subscribers:
- renewal workflow
- intelligence alert

## ContractExpired
Subscribers:
- renewal/closure rules
- integrity checks

## ContractTerminated
Subscribers:
- project/commercial impact assessment
- access/entitlement checks where relevant

---

# 4. Project & Delivery Event Catalog

## ProjectCreated
Subscribers:
- default phases/milestones where configured
- activity timeline
- Jira mapping suggestion
- analytics

## ProjectMemberAssigned
Subscribers:
- workload recalculation
- employee/project timeline

Notifications:
- assigned employee

## ProjectStatusChanged
Subscribers:
- health recalculation
- automation rules
- timeline

## RequirementCreated
Subscribers:
- scope/QA traceability

## RequirementApproved
Subscribers:
- implementation readiness
- QA traceability

## ChangeRequestSubmitted
Subscribers:
- assessment workflow

Notifications:
- project owner / commercial owner according to policy

## ChangeRequestApproved
Subscribers:
- scope update
- quotation/contract impact
- task suggestions/creation policy
- timeline forecast refresh

## ChangeRequestRejected
Subscribers:
- preserve history
- notify requester

## TaskCreated
Subscribers:
- workload metrics
- project timeline
- optional Jira sync

## TaskAssigned
Subscribers:
- employee workload

Notifications:
- assignee

## TaskBlocked
Subscribers:
- project risk score
- dependency analysis
- intelligence alert policy

Notifications:
- assignee
- project owner when severity/age threshold is reached

## TaskCompleted
Subscribers:
- milestone/project progress
- dependent-task readiness

## MilestoneMissed
Subscribers:
- project risk
- command-center alert

## TestFailed
Subscribers:
- bug creation/suggestion policy
- delivery gate recalculation

## BugCreated
Subscribers:
- project health
- Jira sync where configured

## CriticalBugOpened
Subscribers:
- delivery gate block
- project risk

Notifications:
- project owner
- QA/technical responsible roles

## BugResolved
Subscribers:
- retest workflow
- delivery gate refresh

## ProjectReadyForDelivery
Subscribers:
- delivery checklist validation

## ProjectDelivered
Subscribers:
- delivery record
- acceptance workflow
- activation eligibility
- finance/customer success timeline

Notifications:
- project stakeholders according to internal policy

## ProjectAccepted
Subscribers:
- completion/activation rules

## ProjectCompleted
Subscribers:
- profitability finalization snapshot
- customer success handoff
- archive eligibility

## ProjectCancelled
Subscribers:
- task closure policy
- financial/commercial review
- integration sync

---

# 5. Licensing & Entitlement Event Catalog

## LicenseGenerated
Subscribers:
- license timeline
- activation readiness
- audit

## ActivationKeyIssued
Subscribers:
- secure delivery/availability workflow

## LicenseActivated
Subscribers:
- activation record
- warranty-start policy
- update entitlement evaluation
- renewal scheduler
- customer/project timeline
- intelligence metrics

Notifications:
- license/project responsible employee when configured

## ActivationSuspended
Subscribers:
- entitlement validation
- support/customer success timeline

## ActivationDeactivated
Subscribers:
- installation state update
- audit

## LicenseSuspended
Subscribers:
- entitlement checks
- support/customer success alerts where appropriate

## LicenseRevoked
Subscribers:
- activation revocation policy
- entitlement impact
- security/audit timeline
- integration callback where required

Notifications:
- authorized internal stakeholders

## LicenseReactivated
Subscribers:
- entitlement validation
- audit

## LicenseExpiringSoon
Subscribers:
- renewal queue
- intelligence alert

## LicenseExpired
Subscribers:
- entitlement enforcement
- renewal workflow

## WarrantyStarted
Subscribers:
- expiry calculation
- reminder scheduling
- customer/project timeline

## WarrantyExpiringSoon
Subscribers:
- follow-up creation
- renewal opportunity
- command-center alert

Notifications:
- assigned follow-up owner

## WarrantyExpired
Subscribers:
- support eligibility rules
- renewal workflow

## WarrantyRenewed
Subscribers:
- new entitlement/version/period
- reminder rescheduling
- finance/commercial linkage

## UpdateEntitlementExpiringSoon
Subscribers:
- renewal queue
- release/update eligibility signals

## ReleasePublished
Subscribers:
- rollout engine
- eligible installation targeting

## RolloutStarted
Subscribers:
- deployment/install monitoring

## RolloutPaused
Subscribers:
- technical alert

## RolloutCompleted
Subscribers:
- release metrics

---

# 6. Finance Event Catalog

## InvoiceCreated
Subscribers:
- finance timeline

## InvoiceIssued
Subscribers:
- receivable forecast
- due-date scheduler
- customer/project timeline

## InvoicePartiallyPaid
Subscribers:
- outstanding balance recalculation
- upcoming money refresh

## InvoicePaid
Subscribers:
- finance metrics
- project/customer timeline
- profitability refresh

## InvoiceOverdue
Subscribers:
- finance alert
- follow-up policy
- customer health

Notifications:
- finance responsible role
- optional account/project owner according to policy

## InvoiceVoided
Subscribers:
- ledger/forecast correction
- audit

## PaymentReceived
Subscribers:
- allocation workflow
- financial account transaction

## PaymentAllocated
Subscribers:
- invoice/installment status refresh
- finance metrics

## PaymentReconciled
Subscribers:
- account reconciliation state

## RefundRequested
Subscribers:
- approval engine

## RefundApproved
Subscribers:
- finance execution workflow

## RefundCompleted
Subscribers:
- financial transaction update
- invoice/customer timeline

## ExpenseSubmitted
Subscribers:
- approval policy if required

## ExpenseApproved
Subscribers:
- financial reporting

## FinancialPeriodClosed
Subscribers:
- mutation restrictions
- reporting snapshot

---

# 7. Customer Success & Support Event Catalog

## FollowUpCreated
Subscribers:
- owner queue

Notifications:
- assigned employee(s) according to due policy

## FollowUpDue
Subscribers:
- command center

Notifications:
- assignee(s)

## FollowUpCompleted
Subscribers:
- customer timeline
- renewal/sales workflow when applicable

## TicketCreated
Subscribers:
- SLA clock
- warranty eligibility check
- assignment rules

Notifications:
- support assignee/team

## TicketAssigned
Subscribers:
- workload

Notifications:
- assignee

## TicketSLAWarning
Subscribers:
- intelligence alert

Notifications:
- assignee
- manager/owner according to escalation policy

## TicketSLABreached
Subscribers:
- escalation
- customer health
- management alert

## TicketResolved
Subscribers:
- resolution timeline
- CSAT request policy

## TicketReopened
Subscribers:
- SLA/resolution workflow
- customer health

## CSATReceived
Subscribers:
- customer health
- reporting

---

# 8. Identity & Security Event Catalog

## EmployeeInvited
Subscribers:
- onboarding workflow

Notifications:
- invited employee through approved identity channel

## EmployeeActivated
Subscribers:
- onboarding completion

## EmployeeRoleChanged
Subscribers:
- permission cache invalidation
- security audit

Notifications:
- employee for material access changes where policy requires

## PermissionGranted
Subscribers:
- audit
- security monitoring

## PermissionRevoked
Subscribers:
- session/tool authorization refresh
- audit

## TemporaryPermissionGranted
Subscribers:
- expiry scheduler

## TemporaryPermissionExpired
Subscribers:
- automatic revoke
- audit

Notifications:
- affected employee where appropriate

## EmergencyAccessGranted
Subscribers:
- security alert
- expiry scheduler

Notifications:
- designated security/founder approver roles

## SessionRevoked
Subscribers:
- security timeline

## EmployeeOffboardingStarted
Subscribers:
- session revocation
- permission removal
- ownership-transfer workflow

## EmployeeArchived
Subscribers:
- history preservation

## SecurityEventDetected
Subscribers:
- security alerting
- audit/incident workflow

---

# 9. Knowledge / Meetings Event Catalog

## FileUploaded
Subscribers:
- malware/security scanning where implemented
- metadata extraction
- indexing

## DocumentVersionCreated
Subscribers:
- approval/indexing

## DocumentApproved
Subscribers:
- knowledge/search availability

## MeetingCreated
Subscribers:
- calendar integration where enabled

## TranscriptCompleted
Subscribers:
- summary extraction
- decision extraction
- action-item suggestions
- semantic indexing

## DecisionRecorded
Subscribers:
- company/project knowledge
- activity timeline

## KnowledgePagePublished
Subscribers:
- semantic indexing
- knowledge update

---

# 10. Integration Event Catalog

## IntegrationConnected
Subscribers:
- capability discovery
- health monitoring

## IntegrationDisconnected
Subscribers:
- alerting
- dependent workflow degradation notices

## IntegrationHealthFailed
Subscribers:
- retry/health check
- intelligence alert

Notifications:
- integration administrators

## IntegrationJobFailed
Subscribers:
- retry scheduler
- dead-letter policy

## IntegrationJobDeadLettered
Subscribers:
- high-priority alert

Notifications:
- integration administrator / technical owner

## WebhookReceived
Subscribers:
- signature validation
- routing
- idempotency check

## WebhookDeliveryFailed
Subscribers:
- retry scheduler

## SyncConflictDetected
Subscribers:
- conflict-resolution workflow

Notifications:
- relevant data owner/integration administrator

---

# 11. AI / MCP Event Catalog

## AIConversationStarted
Subscribers:
- usage/audit metadata

## AIToolRequested
Subscribers:
- authorization/risk policy

## AIToolApprovalRequested
Subscribers:
- approval engine

Notifications:
- required approver(s)

## AIToolExecuted
Subscribers:
- audit
- tool metrics
- related activity timeline when relevant

## AIToolFailed
Subscribers:
- technical observability

## MCPConnectionEstablished
Subscribers:
- security/integration audit

## MCPToolExecuted
Subscribers:
- same audit and business-event behavior as direct application actions

Rule: MCP/AI actions must trigger the same domain events as human/API actions. Do not create a parallel business workflow.

---

# 12. Notification Architecture

Notifications are delivery records, not the business truth.

```text
Business Event / Alert
→ Notification Policy
→ Recipient Resolution
→ Channel Selection
→ Notification Queue
→ Provider Adapter
→ Delivery Status
```

Core channels:
- In-app
- Email
- Slack
- WhatsApp only where an approved official integration exists

User preferences may control non-critical notifications.
Critical security/system notifications can override preferences according to policy.

---

# 13. Notification Priority Model

```text
INFO
NOTICE
WARNING
HIGH
CRITICAL
```

Recommended behavior:

| Priority | In-app | Email | Slack | Escalation |
|---|---|---|---|---|
| INFO | Optional | Usually no | No | No |
| NOTICE | Yes | Optional | Optional | No |
| WARNING | Yes | Yes/Policy | Optional | Conditional |
| HIGH | Yes | Yes | Yes/Policy | Yes if unresolved |
| CRITICAL | Yes | Yes | Yes where connected | Immediate policy |

Exact channels are configurable by notification type and role.

---

# 14. Notification Matrix — Core Business

| Trigger | Default Recipient | Priority | Default Channel | Escalation |
|---|---|---:|---|---|
| Lead assigned | Lead owner | NOTICE | In-app | No |
| Hot/qualified lead | Lead owner | NOTICE | In-app | No |
| Opportunity requires action | Owner | NOTICE | In-app | No |
| Quotation approval required | Approver | HIGH | In-app + Email | Yes after policy window |
| Contract approval/signature pending | Responsible role | HIGH | In-app + Email | Policy |
| Project task assigned | Assignee | NOTICE | In-app | No |
| Critical task blocked | Assignee + Project owner | HIGH | In-app | Yes |
| Critical bug opened | Project/QA responsible | HIGH | In-app + Slack policy | Yes |
| Delivery gate blocked | Project owner | HIGH | In-app | Yes |
| Project becomes Critical | Project owner + authorized management | CRITICAL | In-app + Email/Slack policy | Yes |
| Invoice overdue | Finance owner | HIGH | In-app + Email | Yes |
| Payment received | Finance owner | NOTICE | In-app | No |
| Payment allocation failed | Finance owner | HIGH | In-app | Yes |
| Warranty expiring | Follow-up owner | WARNING | In-app + Email policy | Yes if no follow-up |
| Warranty expired | Customer success owner | HIGH | In-app | Policy |
| Renewal due | Commercial/customer-success owner | WARNING | In-app | Yes |
| Ticket assigned | Assignee | NOTICE | In-app | No |
| SLA warning | Assignee + manager | HIGH | In-app | Yes |
| SLA breach | Assignee + manager | CRITICAL | In-app + Email/Slack policy | Yes |
| Approval requested | Approver | HIGH | In-app + Email | Yes |
| Approval rejected | Requester | NOTICE | In-app | No |
| Temporary permission expiring | Employee + admin policy | WARNING | In-app | No |
| Emergency access granted | Security/authorized management | CRITICAL | In-app + Email | Immediate |
| Security event critical | Security/authorized management | CRITICAL | In-app + Email + Slack policy | Immediate |
| Integration failed | Integration admin | HIGH | In-app | Yes |
| Dead-letter job | Integration admin | CRITICAL | In-app + Email/Slack | Immediate |
| AI sensitive action approval | Approver | HIGH | In-app | Yes |

---

# 15. Notification Deduplication

Avoid notification floods.

Recommended deduplication key:

```text
notification_type
+ entity_type
+ entity_id
+ recipient_id
+ active_condition_window
```

Examples:
- Do not send an overdue invoice notification every minute.
- Escalate based on age/threshold instead.
- Re-open the alert only after it was resolved and the condition returns.

---

# 16. Notification Preferences

Users may control non-critical preferences by type/channel.

Examples:
- task assignment: in-app + email off
- weekly report: email on
- project warning: Slack on

Cannot be disabled by normal user preference when policy marks them mandatory:
- critical security alerts
- emergency access
- high-risk approval requests assigned to the user
- certain compliance/audit notifications

---

# 17. MCP / AI Tool Architecture

Tool execution path:

```text
AI Client / ChatGPT / Claude
→ MCP Gateway or AI Gateway
→ Identity
→ Permission Check
→ Resource Scope
→ Tool Risk Policy
→ Approval / Confirmation
→ Application Use Case
→ Domain Event
→ Audit
→ Tool Result
```

The tool registry is the only approved route for AI to mutate Dar Tech data.

---

# 18. Tool Risk Levels

## READ
Authorized read-only operation.

## LOW
Reversible or low-impact write.

## MEDIUM
Meaningful business change that may require confirmation/policy.

## HIGH
Financial, commercial, licensing, or security impact. Usually approval/step-up.

## CRITICAL
Potentially destructive, highly privileged, or high-value action. Requires explicit policy, approval, and full audit.

---

# 19. Tool Catalog — Search / Read

| Tool | Purpose | Permission | Risk | Approval |
|---|---|---|---|---|
| `customer.search` | Search authorized customers | `customer.read` | READ | No |
| `customer.get360` | Customer 360 summary | `customer.read` + scoped related permissions | READ | No |
| `lead.search` | Search leads | `lead.read` | READ | No |
| `opportunity.search` | Search opportunities | `opportunity.read` | READ | No |
| `project.search` | Search projects | `project.read` | READ | No |
| `project.get` | Project workspace data | `project.read` | READ | No |
| `project.health.get` | Explain project health | `project.read` | READ | No |
| `task.search` | Search tasks | `task.read` | READ | No |
| `finance.summary` | Authorized finance summary | `finance.summary.read` | READ | No |
| `invoice.get` | Invoice details | `invoice.read` | READ | No |
| `payment.get` | Payment details | `payment.read` | READ | No |
| `license.get` | License status/history | `license.read` | READ | No |
| `warranty.get` | Warranty/coverage | `warranty.read` | READ | No |
| `ticket.search` | Support tickets | `ticket.read` | READ | No |
| `employee.workload.get` | Workload/capacity | `employee.workload.read` | READ | No |
| `knowledge.search` | Permission-aware semantic search | `knowledge.read` | READ | No |
| `integrations.health` | Integration health | `integration.read` | READ | No |
| `audit.search` | Search audit events | `audit.read` | READ | No |

Read tools must never return fields the caller could not access through the normal application UI/API.

---

# 20. Tool Catalog — CRM / Sales Actions

| Tool | Action | Permission | Risk | Approval |
|---|---|---|---|---|
| `lead.create` | Create lead | `lead.create` | LOW | No |
| `lead.update` | Update lead | `lead.update` | LOW | No |
| `lead.qualify` | Qualify lead | `lead.transition.qualify` | MEDIUM | Policy |
| `followup.create` | Create follow-up | `followup.create` | LOW | No |
| `opportunity.create` | Create opportunity | `opportunity.create` | MEDIUM | No/Policy |
| `opportunity.change_stage` | Change pipeline stage | `opportunity.update` | MEDIUM | Policy |
| `quotation.create` | Create draft quotation | `quotation.create` | MEDIUM | No |
| `quotation.submit_review` | Request quotation review | `quotation.submit` | MEDIUM | Workflow |
| `quotation.send` | Send approved quotation | `quotation.send` | HIGH | Policy |
| `contract.create_draft` | Draft contract record | `contract.create` | MEDIUM | No |
| `contract.submit_approval` | Start approval workflow | `contract.submit` | HIGH | Workflow |

AI-generated commercial text remains a draft until normal workflow permits sending/approval.

---

# 21. Tool Catalog — Project Actions

| Tool | Action | Permission | Risk | Approval |
|---|---|---|---|---|
| `project.create` | Create project | `project.create` | MEDIUM | Policy |
| `project.assign_member` | Assign employee | `project.member.manage` | MEDIUM | Policy |
| `task.create` | Create task | `task.create` | LOW | No |
| `task.assign` | Assign task | `task.assign` | MEDIUM | Policy |
| `task.update_status` | Controlled task transition | `task.transition` | LOW/MEDIUM | Policy |
| `change_request.create` | Create CR | `change_request.create` | MEDIUM | No |
| `change_request.submit` | Submit CR | `change_request.submit` | MEDIUM | Workflow |
| `project.delivery.request` | Request delivery workflow | `project.delivery.request` | HIGH | Workflow |
| `project.delivery.override` | Override blocking gate | `project.delivery.override` | CRITICAL | Yes |

---

# 22. Tool Catalog — Licensing Actions

| Tool | Action | Permission | Risk | Approval |
|---|---|---|---|---|
| `license.generate` | Generate/issue license | `license.generate` | HIGH | Policy |
| `activation_key.issue` | Issue activation key | `license.activation_key.issue` | HIGH | Policy |
| `license.activate` | Activate license | `license.activate` | HIGH | Policy/Step-up |
| `license.suspend` | Suspend license | `license.suspend` | HIGH | Policy |
| `license.revoke` | Revoke license | `license.revoke` | CRITICAL | Yes |
| `license.reactivate` | Reactivate revoked/suspended license | `license.reactivate` | CRITICAL | Yes |
| `warranty.renew` | Renew warranty entitlement | `warranty.renew` | HIGH | Commercial/approval policy |
| `updates.renew` | Renew update entitlement | `updates.renew` | HIGH | Commercial/approval policy |
| `release.rollout.start` | Start rollout | `release.rollout.manage` | HIGH | Policy |
| `release.rollout.pause` | Pause rollout | `release.rollout.manage` | HIGH | Policy |

Secret activation/license material must not be exposed to AI unless explicitly required by a secure workflow and permission design. Prefer references/status over raw secret values.

---

# 23. Tool Catalog — Finance Actions

| Tool | Action | Permission | Risk | Approval |
|---|---|---|---|---|
| `invoice.create` | Create draft invoice | `invoice.create` | MEDIUM | No |
| `invoice.issue` | Issue invoice | `invoice.issue` | HIGH | Policy |
| `payment.record` | Record received payment | `payment.create` | HIGH | Policy |
| `payment.allocate` | Allocate payment | `payment.allocate` | HIGH | Policy |
| `expense.create` | Create expense | `expense.create` | MEDIUM | Threshold policy |
| `invoice.void` | Void issued invoice | `invoice.void` | CRITICAL | Yes |
| `refund.request` | Request refund | `refund.request` | HIGH | Workflow |
| `refund.execute` | Execute approved refund | `refund.execute` | CRITICAL | Yes |
| `finance.adjustment.create` | Financial adjustment | `finance.adjustment.create` | CRITICAL | Yes |
| `finance.export` | Export sensitive finance | `finance.export` | HIGH/CRITICAL | Policy + audit |

AI must never silently create/modify money records from conversational intent without explicit action confirmation and policy checks.

---

# 24. Tool Catalog — Support / Knowledge / Meetings

| Tool | Action | Permission | Risk | Approval |
|---|---|---|---|---|
| `ticket.create` | Create support ticket | `ticket.create` | LOW | No |
| `ticket.assign` | Assign ticket | `ticket.assign` | MEDIUM | Policy |
| `ticket.resolve` | Resolve ticket | `ticket.resolve` | MEDIUM | Policy |
| `meeting.create` | Create meeting record | `meeting.create` | LOW | No |
| `transcript.summarize` | Summarize transcript | `transcript.read` | READ | No |
| `transcript.extract_actions` | Suggest action items | `transcript.read` | READ | No |
| `knowledge.draft` | Draft knowledge entry | `knowledge.create` | LOW | No |
| `knowledge.publish` | Publish approved knowledge | `knowledge.publish` | HIGH | Approval policy |
| `decision.record` | Record structured decision | `decision.create` | MEDIUM | Policy |

Extracted tasks/decisions remain suggestions until the user or policy executes the relevant write tool.

---

# 25. Tool Catalog — Identity / Security / Admin

| Tool | Action | Permission | Risk | Approval |
|---|---|---|---|---|
| `employee.search` | Search employee directory | `employee.read` | READ | No |
| `employee.invite` | Invite employee | `employee.invite` | HIGH | Policy |
| `role.assign` | Assign role | `role.assign` | CRITICAL | Yes/Policy |
| `permission.delegate` | Temporary delegation | `permission.delegate` | CRITICAL | Yes |
| `session.revoke` | Revoke session | `session.revoke` | HIGH | Policy |
| `employee.offboard.start` | Start offboarding | `employee.offboard` | CRITICAL | Yes |
| `emergency_access.request` | Request emergency access | `emergency_access.request` | CRITICAL | Yes + step-up |
| `integration.connect` | Connect integration | `integration.manage` | CRITICAL | Yes/Policy |
| `integration.disconnect` | Disconnect integration | `integration.manage` | CRITICAL | Yes/Policy |

AI should not automatically grant roles, permissions, or emergency access.

---

# 26. Tool Catalog — Communication

Possible tools:
- `communication.draft_email`
- `communication.draft_slack`
- `communication.draft_whatsapp`
- `communication.send_email`
- `communication.send_slack`
- `communication.send_whatsapp`

Rules:
1. Draft tools are lower risk.
2. Send tools require sender identity, recipient permission/context, and channel policy.
3. WhatsApp send is available only if an approved official integration exists.
4. AI-generated outreach should default to draft/review rather than autonomous sending.

---

# 27. Tool Input Contract

Every tool must define a strict JSON schema.

Example:

```json
{
  "tool": "license.revoke",
  "input": {
    "licenseId": "uuid",
    "reason": "string",
    "effectiveAt": "optional timestamp"
  }
}
```

Do not allow arbitrary SQL, ORM filters, or provider-specific raw payloads from the model.

---

# 28. Tool Output Contract

Recommended:

```json
{
  "status": "SUCCESS|PENDING_APPROVAL|FAILED",
  "data": {},
  "approvalRequestId": "uuid|null",
  "auditEventId": "uuid|null",
  "message": "human-readable result"
}
```

For read operations, include source references/record IDs where appropriate.

---

# 29. AI Confirmation Policy

Even if backend policy permits an action, the conversational interface should request explicit user confirmation when the user intent could be ambiguous or the action has meaningful side effects.

Examples:
- sending external communication
- issuing invoice
- recording payment
- activating/revoking license
- assigning/removing access

Confirmation is not a substitute for authorization/approval.

---

# 30. Evidence & Source Policy

AI operational answers should label:
- factual system data
- calculated metrics
- forecast/estimate
- AI interpretation

Example:

```text
Outstanding invoice: EGP 50,000 — system record
Project risk: High — calculated rule
Delivery delay probability: 68% — forecast
Recommendation: contact customer today — AI interpretation
```

Never present an AI interpretation as a recorded fact.

---

# 31. Tool Observability

Track per tool:
- execution count
- latency
- success/failure
- approval rate
- denial rate
- provider failures
- user/actor
- source client (Web / ChatGPT / Claude / Slack / MCP client)

High-risk tool executions should be easy to search in Audit.

---

# 32. Failure Handling

For external side effects:

```text
Execution Request
→ Internal transaction
→ Outbox
→ Provider Worker
→ Retry
→ Backoff
→ Dead Letter
→ Alert
```

Do not repeatedly execute a financial/licensing command because an AI client retried a request. Use idempotency.

---

# 33. Notification & Tool Configuration

Administrators may configure:
- notification channel policy
- escalation delays
- required approver roles
- tool risk overrides within safe bounds
- tool enable/disable
- integration availability
- user/channel preferences

But system-critical safety controls should not be casually bypassed through configuration.

---

# 34. Items Still Requiring Validation

Do not let Codex invent these:

1. Exact discount approval thresholds.
2. Exact financial amount thresholds.
3. Exact license revoke/reactivation approval chain.
4. Exact production rollout approval policy.
5. Exact notification escalation timing.
6. Exact default notification channels by department/role.
7. Exact Slack command surface.
8. Exact official WhatsApp provider/integration.
9. Exact Hostinger tool capabilities after API verification.
10. Exact MCP clients/provider credentials and production scopes.

These remain policy/config decisions.

---

# 35. Codex Implementation Requirements

Codex must implement this phase in layers:

```text
1. Event envelope + outbox schema
2. Event dispatcher/worker
3. Typed event catalog
4. Subscriber registry
5. Notification policy engine
6. Notification records + delivery workers
7. Tool registry
8. Tool permission/risk metadata
9. Tool execution service
10. Approval integration
11. MCP adapter
12. AI gateway adapter
13. Audit integration
14. Idempotency
15. Tests
```

Do not implement all provider integrations before the internal event/tool contracts are stable.

---

# 36. Mandatory Tests

At minimum:

1. `LicenseActivated` creates warranty according to policy exactly once.
2. Duplicate outbox delivery does not create duplicate warranty/reminders.
3. Invoice overdue generates one active alert, not repeated spam.
4. Critical alert escalates according to policy.
5. User preferences cannot suppress mandatory security notifications.
6. AI read tool cannot access unauthorized project/customer/finance data.
7. AI/MCP write tool uses the same authorization as REST/UI.
8. `license.revoke` cannot execute without required permission/approval.
9. `payment.record` is idempotent.
10. MCP retry does not duplicate a financial transaction.
11. AI tool action generates audit event.
12. Slack/Jira/Google provider failure enters retry/dead-letter without losing core business state.
13. Communication draft does not send externally.
14. Disabled tool cannot execute through MCP or direct AI gateway.
15. Permission revocation takes effect on later AI/MCP tool calls.

---

# 37. Phase 25 Exit Criteria

Phase 25 is complete when:
- event envelope is defined
- major business events are cataloged
- subscribers/side effects are identified
- notification architecture is defined
- notification priority model exists
- notification matrix exists
- AI/MCP tool registry model exists
- core read/write tools are cataloged
- each tool has permission/risk/approval policy
- AI/MCP shares normal business use cases rather than duplicating logic
- idempotency/audit/failure behavior is defined
- unresolved policy thresholds are explicitly marked

Next recommended phase:
**Phase 26 — Final Codex Implementation Backlog, Epics, Acceptance Gates & Release Plan**.
