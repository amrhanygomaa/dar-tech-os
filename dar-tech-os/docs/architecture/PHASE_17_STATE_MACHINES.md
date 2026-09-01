# Dar Tech OS — Phase 17
## State Machines & Lifecycle Decisions
### Status: Recommended Architecture Selected
### Date: 2026-08-31

The following choices are the recommended defaults for the current Dar Tech OS architecture. They are intentionally designed for a small founding team today while remaining scalable for a larger company later.

## Decisions

1. Lead Lifecycle — **D**
   - Default: New → Researching → Qualified → Contacted → Responded → Nurture → Opportunity → Won/Lost
   - Customizable pipelines supported.

2. Lead Reactivation — **D**
   - Reactivate the existing Lead while preserving the complete history.

3. Opportunity Creation — **D**
   - Normally after Qualification, with manual override.

4. Lost Opportunity Reopen — **D**
   - Reopen with a reason and preserved history.

5. Quotation Lifecycle — **D**
   - Draft → Internal Review → Sent → Viewed → Negotiation → Accepted/Rejected/Expired
   - Custom stages supported.

6. Quotation Acceptance — **D**
   - Follow configurable project/contract creation policy.

7. Contract Lifecycle — **D**
   - Draft → Review → Approved → Sent → Signed → Active → Expiring → Expired/Terminated → Archived
   - Custom workflow supported.

8. Contract Amendment — **D**
   - Amendment + new version + approval.

9. Project Creation State — **C**
   - Initial state depends on Project Type.

10. Project Status — **C**
   - Default workflow with configurable states.

11. Project Completion — **C**
   - Delivery + required acceptance + required gates.

12. Project Cancellation — **C**
   - Cancellation requires reason and approval.

13. Task Lifecycle — **D**
   - Backlog → To Do → In Progress → Blocked → Review → Done/Cancelled
   - Custom workflow supported.

14. Blocked Task — **D**
   - Reason and blocking dependency should be captured.

15. Change Request Lifecycle — **D**
   - Draft → Submitted → Assessment → Quoted → Approval → Approved/Rejected → Implemented
   - Custom workflow supported.

16. Approved Change Request — **C**
   - Task creation depends on change type.

17. QA Test Lifecycle — **D**
   - Draft → Ready → Running → Passed/Failed → Retest.

18. Bug Lifecycle — **D**
   - Open → Triaged → In Progress → Fixed → Retest → Closed → Reopened.

19. Delivery Authorization — **C**
   - Permission-based rather than tied to one job title.

20. Delivery Override — **C**
   - Authorized role + reason + approval + audit.

21. License Lifecycle — **D**
   - Draft/Issued → Activated → Active → Suspended → Expired/Revoked → Reactivated where policy permits.

22. License Generation — **C**
   - Initial status depends on license type.

23. License Revocation — **C**
   - Configurable by reason/risk and permission policy.

24. License Reactivation — **C**
   - Dedicated permission + approval.

25. Activation Lifecycle — **D**
   - Issued → Pending Activation → Activated → Suspended → Deactivated/Revoked.

26. Warranty Lifecycle — **D**
   - Pending Activation → Active → Expiring Soon → Expired → Renewed.
   - Renewal rules remain configurable.

27. Support Ticket Lifecycle — **D**
   - New → Triaged → Assigned → In Progress → Waiting → Resolved → Closed → Reopened.

28. SLA Breach — **C**
   - Escalation + manager notification + activity.

29. Invoice Lifecycle — **D**
   - Draft → Review → Issued → Partially Paid → Paid / Overdue / Void.
   - Custom workflow supported.

30. Invoice After Payment — **C**
   - Use adjustment/credit workflow rather than silently editing financial history.

31. Payment Lifecycle — **D**
   - Pending → Processing → Received → Allocated → Reconciled.

32. Refund — **C**
   - Approval policy configurable by amount/risk.

33. Employee Account Lifecycle — **D**
   - Invited → Active → Suspended → Offboarding → Archived.

34. Employee Role Change — **C**
   - Permission review + effective date + audit.

35. Temporary Permission — **C**
   - Automatic expiration + audit + notification.

36. Approval Request — **D**
   - Draft → Pending → In Review → Approved/Rejected → Executed/Failed.

37. Rejected Approval — **C**
   - Re-submit through revision/new version.

38. Integration Job — **D**
   - Queued → Running → Retrying → Success/Failed → Dead Letter.

39. Webhook Failure — **C**
   - Retry + queue + dead-letter + alert.

40. Archive — **B**
   - Entity-specific archive policies.

41. State Transition Audit — **C**
   - Audit all meaningful business-state transitions.

42. Automatic Side Effects — **C**
   - Configurable workflows can react to state transitions.

43. Rollback — **C**
   - Controlled rollback with authorization and audit.

44. Workflow Customization — **C**
   - Configurable workflow builder rather than an unrestricted state-machine editor.

45. Final-State Protection — **C**
   - Protected final states require an authorized reversal workflow.

## Architecture Consequences

### State changes are first-class events

A meaningful transition should produce an auditable event:

    Entity
      ↓
    State Transition
      ↓
    Validation
      ↓
    Permission / Approval
      ↓
    Side Effects
      ↓
    Audit Event

### Example: License Activation

    License
      ↓
    Activation
      ↓
    Activated
      ↓
    Warranty starts
      ↓
    Renewal date calculated
      ↓
    Reminder automation scheduled
      ↓
    Audit event

### Example: Invoice Payment

    Invoice
      ↓
    Payment Received
      ↓
    Payment Allocation
      ↓
    Invoice Partially Paid / Paid
      ↓
    Finance metrics updated
      ↓
    Audit event

### Example: Warranty Renewal

    Warranty
      ↓
    Expiring Soon
      ↓
    Follow-up created
      ↓
    Customer contacted
      ↓
    Renewal approved
      ↓
    New entitlement/version created
      ↓
    Audit event

## Design Rule

The system should not hard-code every workflow. It should provide strong default workflows while allowing controlled configuration by entity/module.

This gives Dar Tech:
- Fast operation today with four founders.
- A consistent process for current small/medium projects.
- Scalability for future employees and departments.
- Traceable financial, licensing, and customer-success history.
- Automation without hidden state changes.
- A safe foundation for AI/MCP actions.

## Next Phase

Phase 18 — Final ERD / Relationship Architecture.

The next document should convert these entities and state rules into:
- Exact relationships
- Cardinalities
- Foreign-key strategy
- Junction tables
- Versioning
- Audit tables
- Soft-delete/archive strategy
- Tenant/organization boundaries
- Index strategy
- Final database-domain map
