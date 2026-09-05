# S02-T09 Approval Engine Foundation

## Status and boundary

S02-T09 is completed, closed, and merged. This is a generic identity/security foundation, not a production business approval matrix. The compatibility resolver returns explicit `NO_APPROVAL` where no T09 policy is configured. Resolver failure or malformed configured policy fails closed. S02-T10, S02-T11, S02-T13, S02-T14, and S02-T15 remain unauthorized.

No financial threshold, licensing threshold, Founder rule, management override, job-title rule, policy editor, approver configuration, temporary access, emergency access, or business module is installed. The production approver resolver denies every subject until a separately reviewed owning configuration supplies a binding.

## Policy and authorization

`ApprovalPolicyResolver` receives only a trusted actor, canonical action/resource/risk, bounded server context, and current time. Runtime validation recognizes exactly six outcomes: `NO_APPROVAL`, `SINGLE_APPROVER`, `SEQUENTIAL_APPROVAL`, `PARALLEL_APPROVAL`, `STEP_UP_ONLY`, and `STEP_UP_AND_APPROVAL`. It validates policy identity/version, risk equality, step-up requirements, separation rules, subject descriptors, and topology before computing a deterministic SHA-256 fingerprint.

The central `AuthorizationService` remains the only final authorization engine. Its T07 policy seam now evaluates T09 policy after current permission and scope. Approval-aware denials use public-safe `APPROVAL_REQUIRED`, `STEP_UP_REQUIRED`, or `APPROVAL_INVALID_OR_STALE`; dependency or malformed-policy failures remain fail-closed. Permission possession never implies current approver eligibility.

Approval evidence is exact-bound to organization, requester, action, resource type/ID, risk, policy key/version/fingerprint, context fingerprint, approved status, and ready execution state. Arbitrary, cross-organization, stale, wrong-action, or wrong-resource references cannot authorize another operation.

## Topology, step-up, and separation

Single approval has exactly one sequence-1 step. Parallel approval has multiple required sequence-1 steps and completes only when all approve. Sequential approval has contiguous ordered sequence groups; every step in the current group must approve before the next group becomes eligible. T09 has no quorum or any-approver behavior.

Approver subjects are bounded `EMPLOYEE`, `ROLE`, or `RELATIONSHIP` descriptors created only by the policy resolver. `ApprovalApproverResolver` evaluates the current trusted actor at decision time and can receive the active database transaction. `REQUESTER_DIFFERENT_EMPLOYEE` is explicit policy data; there is no inferred global self-approval rule.

`StepUpEvidenceEvaluator` reads only the trusted T04 principal's `assuranceLevel` and `lastStepUpAt`. Assurance must match exactly and evidence age must satisfy the configured bounded freshness. T09 adds no MFA provider, OTP, reauthentication, or client-writable evidence.

Internal preparation and claim methods match the supplied identity selector to `AuthorizationActorContext`, discard supplied assurance/timestamps, and use the server clock. The policy input is a field-by-field projection; extra actor/resource properties never reach the resolver. Context is a bounded scalar map with credential/evidence field names rejected. Public snapshots allow only `displayName` and `label` strings. Owning commands remain responsible for deriving safe current context from their own authoritative records, never a client hash or raw command body.

The approver resolver must validate the whole plan before creation and can use action, resource, policy identity/version, current context, and the transaction when matching a decision. The repository also rechecks active employee/account/session state and enforces an explicitly configured separation rule independently of the subject adapter. No production subject mapping is supplied by this ticket.

## Persistence and concurrency

Migration `20260905120000_sprint_02_t09_approval_engine` adds organization-scoped `ApprovalRequest`, `ApprovalStep`, and `ApprovalHistoryEntry` records with composite organization foreign keys. Request rows contain safe snapshots and fingerprints, not raw request payloads or credentials. Request preparation hashes server idempotency material and atomically creates the request, required steps, initial history, and `ApprovalRequested.v1` outbox event.

Decision transactions lock the organization-scoped request row, validate the current pending sequence, version, and current approver resolution, then use a compare-and-set update. A valid rejection is terminal. Duplicate/concurrent decisions cannot update the same step twice. Approval history is append-only through database triggers rejecting `UPDATE` and `DELETE`.

`APPROVED` is distinct from `EXECUTED`. Internal lifecycle ports allow an owning command to compare-and-set `READY` to `EXECUTING`, perform its own mutation in a supplied transaction, and mark success or failure in that transaction. There is no stored command payload, generic executor, or HTTP execute endpoint. Successful execution is at-most-once and exposes only a bounded result reference.

Preparation is non-authorizing: the central service must first allow the action or report only missing approval/step-up evidence after current permission/scope checks. Creation idempotency binds organization **and requester**, canonical action/resource, current context, policy fingerprint, and hashed server idempotency material. Plan-resolution failures leave no request/steps/history/event behind.

Execution claims reauthorize the exact reference through the central service, then recheck current session state and exact persisted bindings before CAS. A winning claim returns its `claimVersion`; finalization locks the request and requires that version and `EXECUTING`. Concurrent success/failure finalizers cannot both succeed. An owning mutation and success/history/event/audit belong in the same supplied transaction; any exception must roll that transaction back. For durable failure recording, commit the claim first, roll back the failed owning transaction, then record the bounded failure in a separate transaction using the winning claim version. Never swallow a finalization error and commit a partial owning mutation.

A retry of completed work uses a separate non-mutating path: current central permission/scope/policy/step-up checks must pass up to the missing-approval condition, and the repository may return only an exact-bound prior result/processing status. That path cannot transition `READY` or grant execution authority. Permission removal, stale context, changed policy, or mismatched requester/action/resource denies even result replay.

## API, UI, events, and audit

OpenAPI exposes exactly four routes: `GET /approvals`, `GET /approvals/:id`, `POST /approvals/:id/approve`, and `POST /approvals/:id/reject`. There is no public create, request-changes, execute, or policy-authoring route. All routes use the central `approval-request` resource and the existing three approval permission keys; the canonical registry remains 31 entries. Organization-scoped lookup and authorization prevent enumeration.

The `/admin/approvals` inbox shows safe request, target, risk, status, execution, ordered steps, and history data. It renders decision controls only when the API marks a step actionable. The frontend does not author policy, subjects, or step-up state.

List filters are bounded status/risk enums and pagination is capped at 100 rows. This foundation deliberately requires an `ORGANIZATION` read grant for the organization-wide inbox and totals; collection-level extension matches are not assumed to authorize every row. Exact scoped detail/decision access remains supported. A future scoped-list query contract needs separate review. The API supplies separate `canApprove`/`canReject` values after central authorization plus current subject eligibility. `STEP_UP_REQUIRED` returns a safe stronger-authentication message; the UI cannot complete step-up itself.

Transactional outbox contracts cover `ApprovalRequested.v1`, `ApprovalStepApproved.v1`, `ApprovalRejected.v1`, `ApprovalCompleted.v1`, `ApprovedActionExecuted.v1`, and `ApprovedActionExecutionFailed.v1`. T12 audit entries link decision/execution actions to an approval reference without policy internals, subjects, credentials, or raw context.

All six contracts are registered with the existing worker's idempotent local history consumer. No notification, integration, or business subscriber is introduced.

Observability uses bounded outcome/topology categories, one-minute category suppression, and a hard 32-emission window cap. Approval, employee, session, role, resource, correlation, and subject identifiers are not metric labels. Observability exceptions never affect a decision.

Only allowlisted category names and values are emitted: pending-age bucket, decision outcome, execution outcome/failure category, policy-resolution outcome, and topology. Unknown dimensions/values are dropped, not truncated into potentially sensitive labels. Read-time pending-age sampling does not establish an SLA.

## Validation evidence

Unit coverage validates all six outcomes, malformed topology/risk/step-up/separation failure, trusted fresh/missing/stale/wrong-assurance evidence, compatibility default behavior, and rate-bounded observability. PostgreSQL integration validation covers additive migration application, composite organization constraints, append-only history, and migration drift. Final command counts and runtime health belong to the PR report and must not be treated as completion before review and merge.

The real-PostgreSQL approval suites also cover HTTP permission-versus-eligibility, action-specific UI flags, org/scoped-list non-enumeration, rejected client policy/subject/evidence fields, explicit separation, current employee lifecycle, trusted T04 step-up, plan failure rollback, duplicate/concurrent creation, exact execution binding, policy/context changes, permission/scope/role removal after approval, decision order/version/races, execution claim/finalization races, stable reauthorized replay, owning mutation rollback, six event contracts, and real T12 audit linkage.

Migration evidence distinguishes canonical schema validation from workstation state: fresh and canonical seven-migration upgrade databases accepted the single additive T09 migration with zero drift. The existing local `dartech_os` runtime database has pre-existing T02 invitation drift (supersession fields/status and older indexes). T09 deployed there successfully, but this ticket does not rewrite historical migrations, reset runtime data, or claim that local database is drift-free. Repair of that unrelated runtime drift requires a separately authorized decision.

## Final closure evidence

- PR: #15
- Final reviewed implementation head: `fc10a8e87a74421bbcc920fffc3f9f7c4e9e382f`
- Canonical merge/main SHA: `b65f2090643608a48a99fedc9ddd3c96fd2c3cfb`
- Migration: `20260905120000_sprint_02_t09_approval_engine` (destructive: **NO**)
- Unit tests: **275 PASS**; PostgreSQL integration tests: **156 PASS**
- GitHub quality-gate: **PASS** on the exact reviewed head; local quality gate: **PASS**; Docker runtime: **PASS**
- Permission registry: **31/31**, zero issues; fresh migration: **PASS**; canonical upgrade migration: **PASS**; canonical migration drift: **ZERO**
- Production approval policies: **NONE**; production approver bindings: **NONE**; new permission keys: **NONE**
- T10/T11/T13+ implementation: **NONE**; T10+ authorization: **NO**
