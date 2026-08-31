# Dar Tech OS — Phase 21
## Operations Intelligence Design
### Status: Recommended Architecture Baseline
### Date: 2026-08-31

> Purpose: define the intelligence layer that turns Dar Tech OS from a system of record into a system that explains what is happening, what needs attention, what is likely to happen next, and what actions are safe to take.

---

# 1. Core Principle

Operations Intelligence is **not** another CRUD module.

It sits above the business domains:

```text
CRM
Projects
Finance
Licensing
Warranty
Support
Employees
Knowledge
Integrations
        ↓
Intelligence Layer
        ↓
Signals
KPIs
Health Scores
Risks
Forecasts
Alerts
Recommendations
Actions
```

The intelligence layer should never become the source of truth for the underlying business record.

---

# 2. Intelligence Levels

Use four levels:

## Level 1 — Facts
Deterministic, directly derived from records.

Examples:
- invoice overdue
- warranty expires in 42 days
- task overdue
- project milestone missed

## Level 2 — Signals
Rules combine multiple facts.

Examples:
- project has increasing delivery risk
- customer engagement is dropping
- employee capacity is high

## Level 3 — Predictions
Forecasting based on available historical data.

Examples:
- likely project delay
- expected revenue
- likely renewal
- expected capacity pressure

## Level 4 — AI Interpretation
AI explains, summarizes, prioritizes and recommends actions based on authorized evidence.

AI does not silently replace deterministic rules.

---

# 3. Command Center

The default home experience for management should be a **personalized Command Center**.

It answers:

> What requires attention today?

Recommended sections:

```text
Today
├── Critical alerts
├── Approvals waiting
├── Follow-ups due
├── Overdue invoices
├── Project risks
├── Warranty/renewal opportunities
├── Team workload
└── Integration failures
```

The exact cards shown depend on role and permission.

---

# 4. Executive Dashboard

Recommended executive KPIs:

### Sales
- Leads
- Qualified leads
- Opportunities
- Pipeline value
- Weighted pipeline
- Won/Lost
- Conversion
- Average deal value

### Projects
- Active projects
- At-risk projects
- Overdue projects
- Delivery forecast
- Critical bugs
- Blocked work

### Finance
- Revenue
- Outstanding receivables
- Upcoming money
- Overdue invoices
- Expenses
- Project profitability
- Forecast revenue

### Customer Success
- Active warranties
- Expiring warranties
- Renewals due
- Support tickets
- SLA breaches
- Customer health

### Licensing
- Active licenses
- Activations
- Expiring entitlements
- Updates expiring
- Revoked/suspended licenses

### Team
- Capacity
- Utilization
- Overloaded employees
- Blocked assignments

---

# 5. Project Intelligence

## Project Health Score

Recommended score: 0–100.

Do not use a single black-box AI score.

Build the score from explainable factors:

```text
Deadline risk
+ Task health
+ Milestone health
+ QA/Bug health
+ Scope volatility
+ Team capacity
+ Client responsiveness
+ Payment/commercial blockers
= Project Health
```

Recommended categories:

```text
80–100 = Healthy
60–79  = Watch
40–59  = At Risk
0–39   = Critical
```

Thresholds remain configurable.

## Project Risk Drivers

Examples:
- overdue critical tasks
- blocked tasks
- milestone slippage
- unresolved critical bugs
- late client feedback
- repeated scope changes
- insufficient capacity
- payment/commercial blocker

## AI explanation

Example:

```text
Project Health: 47 — At Risk

Main reasons:
1. 2 critical tasks are blocked.
2. Delivery date is 5 days away.
3. Client review has been pending for 3 days.
4. Scope changed twice this week.
```

Each reason should link to its source record.

---

# 6. Project Delivery Forecast

The system should compare:

```text
Planned Delivery
vs
Current Execution
```

Initially use deterministic rules and trend analysis.

Later, historical data can support prediction.

Recommended outputs:
- on track
- likely late
- high likelihood of delay
- insufficient data

Never present a prediction as a guaranteed result.

---

# 7. Customer Intelligence

Customer Health should combine:

```text
Payment
+ Project delivery
+ Support
+ Warranty
+ Renewal
+ Communication
+ Engagement
```

Recommended output:

```text
Customer Health
├── Financial health
├── Delivery health
├── Support health
├── Engagement
└── Renewal potential
```

## Customer Risk

Examples:
- repeated overdue payments
- unresolved support issues
- low communication activity
- warranty approaching expiry without follow-up
- declining engagement
- repeated disputes

AI explains the score using evidence.

---

# 8. Customer Lifetime Value

LTV estimate should use:

```text
Historical revenue
+ recurring revenue
+ renewals
+ upgrades
+ additional services
- relevant costs
```

It is an estimate unless supported by complete historical accounting data.

---

# 9. Lead Intelligence

This is particularly important because the current outreach workflow is spreadsheet-based.

The source data includes fields such as:
- Business Type
- Services
- Source
- Connection
- Manager
- Status
- Notes
- Followers
- Location

and includes multiple business categories such as Dental Clinics, Pet Clinics, Gyms, Automotive, Tourism and others. fileciteturn0file1

The new CRM should convert these into structured data instead of leaving them as spreadsheet text.

## Lead Intelligence questions

The system should be able to answer:

- Which industries generate the most qualified leads?
- Which industries convert to opportunities?
- Which industries convert to won projects?
- Which locations perform best?
- Which service is requested most often?
- Which source/channel produces better opportunities?
- Which outreach owners have stronger conversion?
- What is the average deal size by segment?

## Important constraint

Do not infer "best market" from raw lead count alone.

Use conversion and revenue where sufficient data exists.

---

# 10. Market / Business Segment Analytics

Recommended dimensions:

```text
Industry
Business Type
Business Model
Country
Governorate
City
Location
Company Size
Lead Source
Service Interest
Product Interest
```

This lets Dar Tech discover where its own pipeline performs best.

The system must distinguish:

```text
Observed Data
vs
Calculated Metric
vs
AI Interpretation
```

---

# 11. Sales Intelligence

## Pipeline

Track:
- pipeline value
- weighted value
- stage distribution
- velocity
- win/loss
- sales cycle
- average deal size

## Forecast

Use:

```text
Stage probability
+ historical conversion
+ time in stage
+ rep/project context
```

AI can explain forecast movement.

---

# 12. Finance Intelligence

The original requirements explicitly call for Upcoming Money and income expectations that support expansion planning. fileciteturn0file3

The system should show:

```text
Upcoming Money
├── Due date
├── Customer
├── Project
├── Invoice
├── Expected amount
├── Currency
├── Confidence
└── Status
```

## Finance signals

- overdue invoices
- expected cash inflow
- revenue forecast
- expense trend
- project profitability
- receivable concentration
- upcoming renewal revenue

## Confidence

Forecasts should expose confidence:

```text
Confirmed
Likely
Forecast
Low confidence
```

---

# 13. Renewal Intelligence

Renewal opportunities come from:

- warranty expiry
- update expiry
- subscription renewal
- support renewal
- upgrade opportunities
- feature expansion

Recommended lifecycle:

```text
Upcoming
→ Reminder
→ Follow-up
→ Contacted
→ Negotiation
→ Renewal / Lost / Deferred
```

Default reminders are configurable.

---

# 14. Team Intelligence

Because current projects use estimated hours, capacity intelligence should initially use estimated workload rather than pretend to have precise actual labor tracking.

```text
Assigned Estimated Hours
÷
Available Capacity
=
Utilization Estimate
```

Outputs:
- underutilized
- healthy
- high load
- overloaded

This remains an estimate until actual time tracking is introduced.

---

# 15. Skills Intelligence

Use employee:
- skills
- proficiency
- project history
- current workload

to suggest resource allocation.

Example:

```text
Project requires:
React + Node + AWS

System suggests:
Employee A — strong React
Employee B — strong AWS
```

Recommendations do not automatically reassign employees without policy/approval.

---

# 16. Alerts

Alerts must be classified.

```text
INFO
NOTICE
WARNING
HIGH
CRITICAL
```

Examples:
- warranty expiry
- overdue invoice
- SLA breach
- project critical risk
- integration failure
- permission/security event

Alerts have:
- source
- severity
- owner
- status
- created_at
- due_at where relevant
- resolution

---

# 17. Alert Deduplication

Do not create 200 alerts for the same condition.

Use:

```text
Signal identity
+ entity
+ time window
```

to deduplicate repeated alerts.

Alerts can be re-opened if the condition returns after resolution.

---

# 18. Notifications vs Intelligence Alerts

These are different.

### Intelligence Alert
A meaningful business condition exists.

### Notification
A delivery mechanism that tells someone about it.

Therefore:

```text
Signal
→ Alert
→ Notification Policy
→ In-app / Email / Slack / WhatsApp
```

---

# 19. AI Proactive Recommendations

AI can recommend:

- contact this customer
- follow up on this warranty
- review this project
- investigate this payment risk
- reassign work
- create a task
- prepare a quotation

AI recommendations must include:

```text
Reason
Evidence
Confidence
Recommended action
Required permission
Approval requirement
```

---

# 20. AI Action Policy

Actions are classified:

### Read
No approval if authorized.

### Low-risk write
May execute under policy.

### Medium-risk
Usually confirmation/policy.

### High-risk
Approval and/or step-up authentication.

### Critical
Explicit authorization + approval + audit.

Examples of critical actions:
- revoke license
- change permissions
- export sensitive finance
- material financial adjustment

---

# 21. Executive Briefing

Recommended feature:

```text
Generate Today's Briefing
```

Example structure:

```text
Today

Critical
• Project X may miss delivery.
• Invoice Y is overdue.

Needs Attention
• 3 warranties need follow-up.
• 2 approvals are waiting.

Opportunities
• 4 hot leads.
• 2 likely renewals.

Team
• One employee is over capacity.
```

Every factual statement should link to the source.

---

# 22. Natural Language Operations Search

Examples:

> Show projects at risk.

> Which warranties expire in 60 days?

> What money is expected this month?

> Which industries converted best?

> Which customer has the highest outstanding balance?

The system resolves the query into permission-aware queries and returns traceable results.

---

# 23. Saved Views

Users can save operational views:

```text
At-Risk Projects
My Follow-ups
Overdue Invoices
Renewals Next 90 Days
Hot Leads
My Team Capacity
Integration Failures
```

Views are permission-aware.

---

# 24. Custom KPI Framework

KPIs should not be hard-coded as the only possible dashboard metrics.

Use:

```text
KPI Definition
├── Name
├── Formula
├── Data sources
├── Filters
├── Time window
├── Owner
├── Visibility
└── Version
```

This supports future business changes without code changes for every dashboard metric.

---

# 25. Metric Governance

Every important metric should indicate whether it is:

```text
Observed
Calculated
Estimated
Forecast
AI Interpretation
```

This prevents users from confusing an AI estimate with an actual finance record.

---

# 26. Intelligence Data Model

Recommended core entities:

```text
Signal
Alert
KPI
KPIValue
Forecast
Recommendation
RiskAssessment
HealthScore
SavedView
Dashboard
DashboardWidget
MetricDefinition
```

These should reference source records instead of duplicating entire business records.

---

# 27. Historical Intelligence

Do not calculate every dashboard metric by scanning the entire database on every request.

Use a combination of:
- transactional queries
- materialized/aggregated views where useful
- scheduled metric snapshots
- event-driven metric updates

Start simple and optimize based on observed load.

---

# 28. Data Quality

Operations Intelligence must surface incomplete data.

Examples:

```text
Lead has no owner
Customer has no industry
Project has no delivery date
Invoice has no due date
License has no activation
```

These become data-quality signals rather than silently ignored records.

---

# 29. Integrity Engine Integration

```text
Integrity Rule
→ Conflict/Missing Data
→ Alert
→ Optional AI explanation
→ Resolution task
```

Example:

```text
Contract says 6-month warranty
Project says 12 months
```

The integrity system raises the conflict; AI explains it; a human resolves it.

---

# 30. Permissions

Operations Intelligence itself is permission-aware.

Examples:

```text
Finance user
→ finance dashboards

Project manager
→ assigned project intelligence

Founder
→ company-wide intelligence

Developer
→ relevant project/technical intelligence
```

Sensitive finance/employee data must not leak through aggregate views.

---

# 31. AI Context Boundary

AI receives only the data the current user is allowed to access.

Recommended pipeline:

```text
User
→ Permissions
→ Scope
→ Intelligence Query
→ Source Records
→ AI Context
→ Answer
```

---

# 32. Intelligence Explainability

Every score/forecast should expose:

```text
Score
Why
Evidence
Data freshness
Confidence
```

Example:

```text
Renewal Likelihood: 74%

Confidence: Medium

Drivers:
+ Customer paid on time historically
+ Product actively used
+ Previous renewal
- No contact in 41 days
```

A forecast is not a guarantee.

---

# 33. Operations Intelligence MVP

Recommended first release:

### Command Center
- critical alerts
- overdue tasks
- overdue invoices
- upcoming renewals
- project risks
- pending approvals

### Project Intelligence
- health score
- risk drivers
- delivery status

### Finance
- upcoming money
- outstanding
- overdue invoices

### Customer Success
- warranty expiry
- renewal queue
- ticket/SLA risks

### CRM
- lead pipeline
- conversion basics
- source/industry/service analytics

### Team
- workload/capacity estimate

### Search
- global permission-aware search

---

# 34. Intelligence Phase 2

- predictive delivery forecasting
- renewal propensity
- customer LTV prediction
- advanced lead scoring
- resource allocation recommendations
- anomaly detection
- advanced SaaS metrics
- advanced profitability forecasting
- cross-domain executive briefings

---

# 35. Intelligence Rules

1. Facts come from system records.
2. Calculations must be reproducible.
3. Predictions show confidence.
4. AI interpretations show evidence.
5. AI cannot silently modify source records.
6. Permissions apply to all intelligence views.
7. Sensitive data remains restricted.
8. Incomplete data should be visible as incomplete.
9. Forecasts are not guarantees.
10. Intelligence does not replace the source-of-truth modules.

---

# 36. Phase 21 Exit Criteria

Phase 21 is complete when:

- Command Center structure is defined.
- KPI framework exists.
- Project Health is explainable.
- Customer Health is explainable.
- Lead intelligence dimensions are defined.
- Finance intelligence is defined.
- Renewal intelligence is defined.
- Team capacity intelligence respects estimated-hours limitation.
- Alerts and notifications are separated.
- AI recommendations are policy-controlled.
- Intelligence respects permissions.
- Sources/evidence are traceable.
- MVP vs Phase 2 is defined.

Next recommended phase:
**Phase 22 — Frontend Information Architecture & UX Specification**.
