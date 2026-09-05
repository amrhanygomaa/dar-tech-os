-- S02-T09 adds the organization-scoped approval foundation. The migration is additive.
CREATE TYPE "approval_policy_outcome" AS ENUM ('NO_APPROVAL', 'SINGLE_APPROVER', 'SEQUENTIAL_APPROVAL', 'PARALLEL_APPROVAL', 'STEP_UP_ONLY', 'STEP_UP_AND_APPROVAL');
CREATE TYPE "approval_request_status" AS ENUM ('DRAFT', 'PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED');
CREATE TYPE "approval_step_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "approval_execution_state" AS ENUM ('NOT_READY', 'READY', 'EXECUTING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "approval_history_category" AS ENUM ('REQUESTED', 'STEP_APPROVED', 'REQUEST_REJECTED', 'APPROVAL_COMPLETED', 'EXECUTION_STARTED', 'EXECUTION_SUCCEEDED', 'EXECUTION_FAILED');
CREATE TYPE "approval_approver_subject_type" AS ENUM ('EMPLOYEE', 'ROLE', 'RELATIONSHIP');
CREATE TYPE "approval_separation_rule" AS ENUM ('NONE', 'REQUESTER_DIFFERENT_EMPLOYEE');

CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requester_employee_id" UUID NOT NULL,
    "requester_snapshot" JSONB NOT NULL,
    "action_key" VARCHAR(160) NOT NULL,
    "resource_type" VARCHAR(80) NOT NULL,
    "resource_id" VARCHAR(128),
    "resource_snapshot" JSONB,
    "server_context_snapshot" JSONB NOT NULL,
    "context_fingerprint" CHAR(64) NOT NULL,
    "risk" "event_risk" NOT NULL,
    "policy_key" VARCHAR(160) NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "policy_outcome" "approval_policy_outcome" NOT NULL,
    "policy_fingerprint" CHAR(64) NOT NULL,
    "step_up_assurance_level" VARCHAR(80),
    "step_up_max_age_seconds" INTEGER,
    "status" "approval_request_status" NOT NULL DEFAULT 'PENDING',
    "safe_request_reason" VARCHAR(500),
    "correlation_id" VARCHAR(128) NOT NULL,
    "idempotency_digest" CHAR(64) NOT NULL,
    "execution_state" "approval_execution_state" NOT NULL DEFAULT 'NOT_READY',
    "execution_result_reference" VARCHAR(128),
    "execution_failure_code" VARCHAR(80),
    "version" INTEGER NOT NULL DEFAULT 1,
    "approved_at" TIMESTAMPTZ(3),
    "rejected_at" TIMESTAMPTZ(3),
    "executed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_requests_versions_check" CHECK ("policy_version" > 0 AND "version" > 0),
    CONSTRAINT "approval_requests_step_up_shape_check" CHECK (("step_up_assurance_level" IS NULL AND "step_up_max_age_seconds" IS NULL) OR ("step_up_assurance_level" IS NOT NULL AND "step_up_max_age_seconds" BETWEEN 1 AND 86400)),
    CONSTRAINT "approval_requests_fingerprint_check" CHECK ("context_fingerprint" ~ '^[0-9a-f]{64}$' AND "policy_fingerprint" ~ '^[0-9a-f]{64}$' AND "idempotency_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "approval_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "approval_request_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "approver_subject_type" "approval_approver_subject_type" NOT NULL,
    "approver_subject_key" VARCHAR(160) NOT NULL,
    "separation_rule" "approval_separation_rule" NOT NULL DEFAULT 'NONE',
    "status" "approval_step_status" NOT NULL DEFAULT 'PENDING',
    "decided_by_employee_id" UUID,
    "safe_decision_reason" VARCHAR(500),
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_steps_order_version_check" CHECK ("sequence" BETWEEN 1 AND 100 AND "version" > 0),
    CONSTRAINT "approval_steps_decision_shape_check" CHECK (("status" = 'PENDING' AND "decided_by_employee_id" IS NULL AND "decided_at" IS NULL) OR ("status" <> 'PENDING' AND "decided_by_employee_id" IS NOT NULL AND "decided_at" IS NOT NULL))
);

CREATE TABLE "approval_history_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "approval_request_id" UUID NOT NULL,
    "approval_step_id" UUID,
    "actor_employee_id" UUID,
    "category" "approval_history_category" NOT NULL,
    "request_status" "approval_request_status" NOT NULL,
    "execution_state" "approval_execution_state" NOT NULL,
    "safe_reason" VARCHAR(500),
    "correlation_id" VARCHAR(128) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_history_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "approval_requests_organization_status_created_idx" ON "approval_requests"("organization_id", "status", "created_at");
CREATE INDEX "approval_requests_organization_requester_created_idx" ON "approval_requests"("organization_id", "requester_employee_id", "created_at");
CREATE INDEX "approval_requests_organization_execution_updated_idx" ON "approval_requests"("organization_id", "execution_state", "updated_at");
CREATE UNIQUE INDEX "approval_requests_organization_id_id_key" ON "approval_requests"("organization_id", "id");
CREATE UNIQUE INDEX "approval_requests_organization_idempotency_key" ON "approval_requests"("organization_id", "idempotency_digest");
CREATE INDEX "approval_steps_request_sequence_status_idx" ON "approval_steps"("organization_id", "approval_request_id", "sequence", "status");
CREATE UNIQUE INDEX "approval_steps_organization_id_id_key" ON "approval_steps"("organization_id", "id");
CREATE UNIQUE INDEX "approval_steps_organization_request_id_key" ON "approval_steps"("organization_id", "approval_request_id", "id");
CREATE INDEX "approval_history_request_occurred_idx" ON "approval_history_entries"("organization_id", "approval_request_id", "occurred_at", "id");
CREATE INDEX "approval_history_organization_category_idx" ON "approval_history_entries"("organization_id", "category", "occurred_at");

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_requester_employee_id_fkey" FOREIGN KEY ("organization_id", "requester_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_organization_id_approval_request_id_fkey" FOREIGN KEY ("organization_id", "approval_request_id") REFERENCES "approval_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_organization_id_decided_by_employee_id_fkey" FOREIGN KEY ("organization_id", "decided_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_history_entries" ADD CONSTRAINT "approval_history_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_history_entries" ADD CONSTRAINT "approval_history_request_fkey" FOREIGN KEY ("organization_id", "approval_request_id") REFERENCES "approval_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_history_entries" ADD CONSTRAINT "approval_history_step_fkey" FOREIGN KEY ("organization_id", "approval_request_id", "approval_step_id") REFERENCES "approval_steps"("organization_id", "approval_request_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_history_entries" ADD CONSTRAINT "approval_history_entries_organization_id_actor_employee_id_fkey" FOREIGN KEY ("organization_id", "actor_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_approval_history_mutation"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'approval history records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "approval_history_entries_append_only"
BEFORE UPDATE OR DELETE ON "approval_history_entries"
FOR EACH ROW EXECUTE FUNCTION "prevent_approval_history_mutation"();
