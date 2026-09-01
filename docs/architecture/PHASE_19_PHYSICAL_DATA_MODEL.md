# Dar Tech OS — Phase 19
## Physical Data Model Blueprint
### Status: Recommended Implementation Baseline
### Date: 2026-08-31

> This document converts the logical ERD into a physical database blueprint. It is a recommended implementation baseline, not a final ORM migration. Exact database engine and ORM can be selected in the backend phase.

---

## 1. Recommended Database Strategy

### Primary recommendation
Use a relational SQL database as the system of record.

Recommended baseline:
- PostgreSQL-class relational database
- UUID primary keys
- UTC timestamps
- Explicit foreign keys
- Explicit junction tables for many-to-many relationships
- JSON/JSONB only for genuinely flexible metadata/configuration
- Object/file storage outside the relational database, with metadata stored in SQL

### Why
The system has strong relationships across Projects, Customers, Contracts, Invoices, Payments, Licenses, Activations, Warranty, Employees, and Audit records. Referential integrity is important.

---

# 2. ID Strategy

### Primary key
Use UUID for major entities.

Example:

```text
id UUID PRIMARY KEY
```

### Human-readable codes
Business entities that employees reference should also have a human-readable code/number.

Examples:
- employee_code
- customer_code
- lead_code
- project_code
- opportunity_code
- quotation_number
- contract_number
- invoice_number
- ticket_number
- license_code

Do not use these codes as database primary keys.

---

# 3. Standard Audit Columns

Most mutable business tables should include:

```text
id
organization_id
created_at
created_by
updated_at
updated_by
archived_at
archived_by
```

Not every table needs every column, but core business aggregates should preserve actor attribution.

For append-only records such as AuditEvent, do not allow ordinary updates.

---

# 4. Organization / Identity

## organizations

Key fields:

```text
id
name
legal_name
status
timezone
default_currency
settings_json
created_at
updated_at
```

Unique:
- organization name subject to business policy

Indexes:
- status

## departments

```text
id
organization_id
name
code
status
created_at
updated_at
```

Unique:
- organization_id + code

## teams

```text
id
organization_id
department_id
name
code
status
created_at
updated_at
```

## employees

```text
id
organization_id
employee_code
first_name
last_name
display_name
work_email
phone
job_title
status
department_id
manager_id
joined_at
left_at
profile_json
created_at
updated_at
```

Indexes:
- organization_id + status
- work_email
- manager_id

## employee_team_memberships

```text
id
employee_id
team_id
role_label
start_at
end_at
```

## user_accounts

```text
id
employee_id
status
last_login_at
last_activity_at
mfa_required
created_at
updated_at
```

Unique:
- employee_id

## sso_identities

```text
id
employee_id
provider
provider_subject
provider_email
metadata_json
linked_at
unlinked_at
```

Unique:
- provider + provider_subject

## sessions

```text
id
user_account_id
issued_at
expires_at
revoked_at
ip_address
user_agent
device_metadata_json
```

Indexes:
- user_account_id + revoked_at

---

# 5. Authorization

## roles

```text
id
organization_id
name
code
description
is_system_role
status
```

Unique:
- organization_id + code

## employee_roles

```text
id
employee_id
role_id
starts_at
ends_at
assigned_by
```

## permissions

```text
id
resource
action
description
risk_level
```

Unique:
- resource + action

Examples:

```text
projects.view
projects.create
projects.update
finance.invoice.view
finance.invoice.export
license.revoke
otp.account.access
```

## role_permissions

```text
id
role_id
permission_id
scope_type
scope_config_json
```

## employee_permission_overrides

```text
id
employee_id
permission_id
effect
scope_type
scope_config_json
starts_at
ends_at
reason
approved_by
```

## approval_policies

```text
id
organization_id
name
resource
action
risk_level
conditions_json
approval_chain_json
status
version
```

---

# 6. CRM

## leads

```text
id
organization_id
lead_code
business_name
status
priority
score
industry_id
business_type_id
business_model
business_size
estimated_employees
revenue_range
website_url
owner_employee_id
converted_customer_id
source_id
qualification_status
qualification_notes
created_at
updated_at
```

## lead_contacts

```text
id
lead_id
name
job_title
email
phone
whatsapp
social_links_json
is_primary
```

## lead_locations

```text
id
lead_id
country
region
governorate
city
area
address
is_primary
```

## lead_sources

```text
id
organization_id
channel
name
campaign
referrer_employee_id
external_source
metadata_json
```

## lead_research_facts

```text
id
lead_id
field_name
value_json
source_type
source_reference
collected_by
collected_at
confidence
verified_at
```

This supports provenance for followers, website findings, business size, digital maturity, etc.

## lead_outreach_activities

```text
id
lead_id
employee_id
channel
activity_type
message_template_id
content
result
performed_at
next_follow_up_at
notes
```

## opportunities

```text
id
organization_id
opportunity_code
lead_id
customer_id
pipeline_id
stage_id
owner_employee_id
estimated_value
currency
probability
expected_close_at
status
lost_reason_id
created_at
updated_at
```

## sales_pipelines

```text
id
organization_id
name
code
entity_type
status
```

## sales_pipeline_stages

```text
id
pipeline_id
name
code
sequence
probability_default
terminal_type
```

## activities

Generic business activity record for controlled timeline/event use.

```text
id
organization_id
actor_employee_id
activity_type
entity_type
entity_id
title
description
occurred_at
metadata_json
```

---

# 7. Commercial

## quotations

```text
id
organization_id
quotation_number
customer_id
opportunity_id
project_id
status
currency
valid_until
accepted_version_id
created_at
updated_at
```

## quotation_versions

```text
id
quotation_id
version_number
status
subtotal
discount_amount
tax_amount
total
currency
terms_json
created_by
created_at
```

## quotation_items

```text
id
quotation_version_id
product_id
service_code
description
quantity
unit_price
discount_amount
tax_rate
total
```

## negotiation_records

```text
id
quotation_id
actor_employee_id
previous_value_json
requested_change_json
reason
occurred_at
```

## contracts

```text
id
organization_id
contract_number
status
start_at
end_at
customer_relationship_type
commercial_currency
current_version_id
```

## contract_parties

```text
id
contract_id
customer_id
party_role
is_primary
```

## contract_projects

```text
id
contract_id
project_id
relationship_type
```

## contract_versions

```text
id
contract_id
version_number
status
scope_json
payment_terms_json
warranty_terms_json
update_terms_json
special_terms_json
document_id
created_by
created_at
```

## commercial_benefits

```text
id
organization_id
customer_id
project_id
product_id
type
description
value_json
starts_at
ends_at
reason
status
approved_by
```

---

# 8. Projects

## projects

```text
id
organization_id
project_code
name
project_type
status
health_status
start_date
target_delivery_date
actual_delivery_date
created_from_opportunity_id
created_from_contract_id
description
internal_notes
```

## project_customers

```text
id
project_id
customer_id
relationship_type
is_primary
commercial_role
starts_at
ends_at
```

## project_members

```text
id
project_id
employee_id
project_role
responsibilities
starts_at
ends_at
is_active
```

## project_products

```text
id
project_id
product_id
plan_id
quantity
configuration_json
status
```

## project_phases

```text
id
project_id
name
code
sequence
status
start_date
target_date
actual_date
completion_percentage
```

## milestones

```text
id
project_phase_id
name
sequence
status
due_date
completed_at
health_impact
```

## project_requirements

```text
id
project_id
requirement_code
title
description
priority
status
approved_version_id
```

## requirement_versions

```text
id
requirement_id
version_number
content_json
status
created_by
created_at
approved_by
approved_at
```

## project_scopes

```text
id
project_id
scope_type
content_json
version_number
status
created_by
approved_by
```

## change_requests

```text
id
project_id
request_number
status
requested_by_type
requested_by_id
description
cost_impact
time_impact_days
resource_impact_json
risk_impact_json
quotation_id
approved_at
rejected_at
implemented_at
```

---

# 9. Tasks / QA / Jira

## tasks

```text
id
organization_id
project_id
phase_id
milestone_id
parent_task_id
title
description
task_type
status
priority
assignee_id
due_at
estimated_hours
source_type
source_id
created_at
updated_at
```

## task_collaborators

```text
id
task_id
employee_id
collaboration_type
```

## task_dependencies

```text
id
task_id
depends_on_task_id
dependency_type
```

## bugs

```text
id
project_id
task_id
test_run_id
title
description
severity
priority
status
found_at
fixed_at
reopened_at
```

## test_cases

```text
id
project_id
requirement_id
name
description
steps_json
expected_result
status
```

## test_runs

```text
id
test_case_id
run_by
status
started_at
completed_at
notes
```

## jira_projects

```text
id
integration_id
external_project_id
name
metadata_json
```

## jira_mappings

```text
id
integration_id
entity_type
entity_id
external_entity_type
external_entity_id
sync_policy
last_synced_at
```

The `entity_type/entity_id` model should only be used at the integration boundary; core business relationships should use real foreign keys.

---

# 10. Product / License

## products

```text
id
organization_id
name
code
product_type
status
licensing_model
warranty_policy_id
update_policy_id
```

## plans

```text
id
product_id
name
code
billing_model
price
currency
status
```

## features

```text
id
product_id
code
name
description
status
```

## plan_features

```text
id
plan_id
feature_id
limits_json
```

## product_versions

```text
id
product_id
version
release_date
status
changelog_document_id
```

## releases

```text
id
product_version_id
release_name
release_type
status
release_date
```

## rollouts

```text
id
release_id
strategy
target_config_json
percentage
status
started_at
completed_at
```

## licenses

```text
id
organization_id
license_code
product_id
plan_id
customer_id
project_id
status
issued_at
expires_at
metadata_json
```

Customer may be null for internal licenses.

## activation_keys

```text
id
license_id
key_hash
key_last4
status
issued_at
activated_at
revoked_at
```

Do not store recoverable plaintext activation keys unless a specific security architecture requires it.

## activations

```text
id
license_id
activation_key_id
status
activated_at
deactivated_at
revoked_at
machine_fingerprint_hash
environment
platform
metadata_json
```

## installations

```text
id
activation_id
installation_identifier_hash
version_id
environment
platform
installed_at
last_seen_at
uninstalled_at
status
```

---

# 11. Entitlements / Warranty / Support

## entitlements

```text
id
organization_id
customer_id
project_id
product_id
license_id
type
status
start_at
end_at
source_type
source_id
conditions_json
```

## warranty_entitlements

```text
id
entitlement_id
coverage_json
exclusions_json
conditions_json
```

## update_entitlements

```text
id
entitlement_id
included_features_json
update_channel
```

## support_entitlements

```text
id
entitlement_id
sla_policy_id
coverage_json
```

## sla_policies

```text
id
organization_id
name
priority
response_target_minutes
resolution_target_minutes
escalation_policy_json
status
```

## tickets

```text
id
organization_id
ticket_number
customer_id
project_id
product_id
license_id
activation_id
warranty_entitlement_id
priority
status
assignee_id
sla_policy_id
opened_at
resolved_at
closed_at
```

## ticket_tasks

```text
id
ticket_id
task_id
```

## follow_ups

```text
id
organization_id
customer_id
project_id
trigger_type
status
due_at
outcome
next_action_at
created_by
```

## follow_up_assignees

```text
id
follow_up_id
employee_id
assignment_type
```

---

# 12. Finance

## financial_accounts

```text
id
organization_id
name
account_type
currency
status
```

## invoices

```text
id
organization_id
invoice_number
customer_id
project_id
contract_id
subscription_id
status
currency
subtotal
discount_amount
tax_amount
total
due_date
issued_at
```

## invoice_items

```text
id
invoice_id
product_id
description
quantity
unit_price
discount_amount
tax_rate
total
```

## installments

```text
id
invoice_id
sequence
amount
due_date
status
```

## payments

```text
id
organization_id
payment_number
customer_id
account_id
amount
currency
payment_method
received_at
status
reference
notes
```

## payment_allocations

```text
id
payment_id
invoice_id
installment_id
allocated_amount
allocated_at
```

## expenses

```text
id
organization_id
project_id
supplier_id
employee_id
category
amount
currency
occurred_at
status
attachment_document_id
```

## financial_transactions

```text
id
financial_account_id
transaction_type
reference_type
reference_id
amount
currency
occurred_at
metadata_json
```

## financial_periods

```text
id
organization_id
name
start_date
end_date
status
closed_at
closed_by
```

## reconciliations

```text
id
financial_account_id
period_start
period_end
statement_reference
status
reconciled_at
reconciled_by
```

## adjustments

```text
id
organization_id
adjustment_type
customer_id
invoice_id
amount
currency
reason
status
approved_by
```

---

# 13. Procurement / Suppliers / Assets

## suppliers

```text
id
organization_id
name
email
phone
status
metadata_json
```

## purchase_requests

```text
id
organization_id
requested_by
status
reason
items_json
approved_by
```

## purchase_orders

```text
id
organization_id
supplier_id
request_id
status
currency
total
ordered_at
```

## assets

```text
id
organization_id
asset_code
asset_type
name
serial_number
status
purchase_date
purchase_cost
currency
```

## employee_assets

```text
id
employee_id
asset_id
assigned_at
returned_at
condition_out
condition_in
```

---

# 14. Meetings / Knowledge

## meetings

```text
id
organization_id
customer_id
project_id
title
agenda
scheduled_start
scheduled_end
status
location_or_link
```

## meeting_participants

```text
id
meeting_id
employee_id
contact_id
participant_type
attendance_status
```

## communications

```text
id
organization_id
customer_id
contact_id
project_id
employee_id
channel
direction
subject
content
occurred_at
external_message_id
```

## files

```text
id
organization_id
name
mime_type
size_bytes
storage_key
checksum
sensitivity
uploaded_by
uploaded_at
```

## file_links

```text
id
file_id
entity_type
entity_id
category_id
is_primary
```

## file_versions

```text
id
file_id
version_number
storage_key
checksum
created_by
created_at
```

## documents

```text
id
organization_id
type
customer_id
project_id
contract_id
invoice_id
status
current_version_id
sensitivity
```

## document_versions

```text
id
document_id
version_number
file_id
extracted_data_json
approval_status
created_by
created_at
```

## transcripts

```text
id
meeting_id
file_id
transcript_text
language
status
summary_text
decisions_json
action_items_json
created_at
```

## transcript_speakers

```text
id
transcript_id
speaker_label
linked_contact_id
linked_employee_id
confidence
```

## company_knowledge

```text
id
organization_id
title
category
status
current_version_id
access_policy_json
```

## company_knowledge_versions

```text
id
knowledge_id
version_number
content
source_document_id
status
created_by
approved_by
created_at
```

## decisions

```text
id
organization_id
title
category
status
decision_date
effective_at
decided_by
reason
```

## decision_versions

```text
id
decision_id
version_number
old_value_json
new_value_json
reason
created_by
created_at
```

---

# 15. AI / Automation / Integrity

## automation_rules

```text
id
organization_id
name
trigger_type
conditions_json
actions_json
status
version
```

## automation_executions

```text
id
rule_id
trigger_event_id
status
started_at
completed_at
attempts
error_message
```

## ai_conversations

```text
id
organization_id
employee_id
provider
model
context_scope_json
started_at
ended_at
```

## ai_messages

```text
id
conversation_id
role
content
created_at
```

## ai_tool_executions

```text
id
conversation_id
tool_id
input_json
output_json
status
risk_level
started_at
completed_at
approval_request_id
```

## ai_tools

```text
id
name
version
description
required_permission_id
risk_level
approval_policy_id
status
```

## integrity_alerts

```text
id
organization_id
rule_code
severity
entity_type
entity_id
description
status
detected_at
resolved_at
resolved_by
resolution_notes
```

---

# 16. Integrations / MCP

## integrations

```text
id
organization_id
provider
type
status
configuration_json
connected_at
last_health_check_at
```

## integration_scopes

```text
id
integration_id
scope_name
enabled
```

## integration_jobs

```text
id
integration_id
operation
entity_type
entity_id
payload_json
status
attempts
next_retry_at
error_message
created_at
completed_at
```

## webhooks

```text
id
organization_id
integration_id
direction
event_type
endpoint
enabled
secret_reference
```

## webhook_deliveries

```text
id
webhook_id
event_id
status
attempts
next_retry_at
response_code
response_body_excerpt
```

## mcp_connections

```text
id
organization_id
provider
connection_type
status
scopes_json
created_at
```

---

# 17. Audit / Security

## audit_events

```text
id
organization_id
actor_type
actor_id
action
entity_type
entity_id
old_value_json
new_value_json
ip_address
session_id
source
occurred_at
metadata_json
```

Append-oriented.

## security_events

```text
id
organization_id
employee_id
user_account_id
event_type
success
ip_address
user_agent
occurred_at
metadata_json
```

## approval_requests

```text
id
organization_id
requester_id
resource
action
entity_type
entity_id
risk_level
status
requested_at
resolved_at
```

## approval_steps

```text
id
approval_request_id
sequence
approver_type
approver_id
status
decision
reason
decided_at
```

---

# 18. Relationship / Constraint Rules

## Uniqueness
Use organization-scoped uniqueness for human/business codes.

Examples:

```text UNIQUE(organization_id, project_code)
UNIQUE(organization_id, invoice_number)
UNIQUE(organization_id, employee_code)
```

## Foreign keys
Core relationships must use real FK constraints.

## Delete behavior
Recommended default:

```text ON DELETE RESTRICT
```
for historical/core entities.

Use cascade only for true child records whose lifecycle is inseparable from the parent, and only after review.

## Nullable relationships
Use nullable FKs where the business model genuinely permits absence:

```text license.customer_id → nullable for internal products
project.contract_id → nullable depending on workflow
invoice.project_id → nullable for non-project invoices
```

---

# 19. Indexing Strategy

Priority indexes:

### CRM
- leads: organization_id + status
- leads: organization_id + score
- leads: industry_id + location
- outreach: lead_id + performed_at
- opportunities: pipeline_id + stage_id

### Projects
- projects: organization_id + status
- project_members: project_id + employee_id
- tasks: project_id + status
- tasks: assignee_id + status
- tickets: customer_id + status

### Finance
- invoices: customer_id + status
- invoices: due_date + status
- payments: customer_id + received_at
- payment_allocations: invoice_id
- expenses: project_id + occurred_at

### Licensing
- licenses: customer_id + status
- licenses: product_id + status
- activations: license_id + status
- installations: activation_id + last_seen_at

### Security
- audit_events: organization_id + occurred_at
- audit_events: entity_type + entity_id
- security_events: employee_id + occurred_at

---

# 20. Status / Enum Policy

Do not hard-code all business statuses as database enums if the product needs controlled customization.

Recommended:
- stable technical types as enums
- customizable business workflows as rows/configuration

Example:

```text task_type = technical enum/catalog
workflow status = configurable record
```

This preserves the approved customizable workflow direction.

---

# 21. Data Retention

### Long-lived / historical
- Contracts
- Invoices
- Payments
- Licenses
- Activations
- Warranty
- Audit events
- Employee history
- Project history

### Potentially shorter technical retention
- Integration job payload details
- Webhook delivery bodies
- Temporary AI execution metadata

Exact retention periods are a later security/compliance policy decision.

---

# 22. Physical Storage Separation

Do not store large binary files, videos, recordings, or large attachments directly in core relational tables.

Use:

```text
SQL
→ metadata / relationship / permissions

Object Storage
→ file bytes
```

The `storage_key` and checksum are stored in SQL.

---

# 23. Important Security Rules

1. Never store plaintext passwords in business tables.
2. Activation keys should be protected; store hashes or encrypted secrets where appropriate.
3. Integration credentials belong in dedicated secret storage.
4. Audit records should not be editable by ordinary users.
5. Sensitive data must not become searchable outside the user's scope.
6. AI tool execution must be associated with an authenticated actor/context.
7. Export actions must be permission controlled and audited.

---

# 24. Current Database Status

### Architecture ready
- Core domain boundaries
- Main entities
- Primary relationship strategy
- Junction entities
- Versioning approach
- Audit model
- Permission model
- Integration model
- AI/MCP model

### Still to finalize in backend phase
- exact DB engine/version
- ORM
- migrations strategy
- API DTOs
- transaction boundaries
- idempotency strategy
- event/outbox implementation
- caching
- queue infrastructure
- secret manager
- object storage provider
- search engine/vector store if required

---

# 25. Next Phase

## Phase 20 — Backend Architecture & API Design

It will define:
- backend modules
- domain/application/infrastructure boundaries
- REST API
- authentication middleware
- authorization middleware
- service layer
- repositories
- transactions
- event bus
- background workers
- queues
- integration adapters
- AI tool execution
- MCP gateway
- file service
- notification service
- search service
- reporting service
- observability
- error handling
- idempotency
- API versioning

The goal is to create an implementation blueprint for the developer, not just a conceptual architecture.
