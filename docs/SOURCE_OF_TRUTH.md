# Source of Truth & Conflict Policy

## Precedence

When two documents conflict, use this order:

1. Latest explicit supervisor decision.
2. This source-of-truth/conflict file when it explicitly records a resolved decision.
3. Master PRD / approved implementation specification.
4. Domain-specific phase specification.
5. Original System Requirements.
6. Company/brand source documents for company and visual identity facts.
7. Existing code, only where it does not contradict the approved specification.
8. Engineering judgment for ordinary implementation details.

## Non-negotiable product rules

- Dar Tech OS is internal-only in the current scope.
- Do not create customer portal accounts.
- Warranty starts from Activation, not Delivery.
- Warranty and Update Entitlement are independent.
- A Project may have multiple Customers.
- A Project may have multiple Employees with explicit project roles.
- A License may have multiple Activation Keys.
- Finance supports installments and partial payments.
- AI/MCP must use the same authorization and business use cases as the web/API.
- AI/MCP never receives direct unrestricted database access.
- Full HR is out of current scope.

## Known source conflicts / NEEDS_VALIDATION

### Brand blue exact hex
Two approved/current-looking sources contain different blue values:
- Brand Guidelines PDF: `#0A4FD1`
- AI Agent Company Memory: `#094FD1`

Do not silently choose one for final production design tokens. Mark as `NEEDS_VALIDATION` when the design-system implementation reaches this decision.

### Legacy customer portal
The original System Requirements included a customer portal concept. Later explicit project decisions removed customer portal accounts from current scope. The **later internal-only decision wins**.

### Brand messaging
The Brand Guidelines PDF contains legacy messaging such as “Engineering the Future”; the newer AI Agent Company Memory explicitly marks it legacy/deprecated for current positioning. For product UI/brand copy, prefer the newer approved company memory unless the supervisor explicitly re-approves legacy wording.

## Stop conditions

Codex must use `NEEDS_SUPERVISOR_DECISION` and stop that specific decision when unresolved questions materially affect:
- money/accounting
- licensing
- warranty/entitlements
- authorization/roles/permissions
- destructive migrations/data retention
- customer access
- production infrastructure/security
- AI/MCP critical action policy
