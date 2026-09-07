CREATE TYPE "offboarding_cleanup_status" AS ENUM ('PENDING', 'INCOMPLETE', 'COMPLETED');

ALTER TABLE "temporary_access_grants"
  DROP CONSTRAINT "temporary_access_grants_terminal_check",
  ADD CONSTRAINT "temporary_access_grants_terminal_check" CHECK (
    ("status" = 'PENDING_APPROVAL' AND "granted_at" IS NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
    OR ("status" = 'GRANTED' AND "granted_at" IS NOT NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
    OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revoked_by_employee_id" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "granted_at" IS NOT NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
  );

ALTER TABLE "employees"
  ADD COLUMN "lifecycle_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "offboarding_source_lifecycle" "employee_lifecycle_status",
  ADD COLUMN "offboarding_initiated_by_employee_id" UUID,
  ADD COLUMN "offboarding_reason" VARCHAR(500),
  ADD COLUMN "offboarding_approval_reference" UUID,
  ADD COLUMN "offboarding_cleanup_status" "offboarding_cleanup_status",
  ADD COLUMN "offboarding_cleanup_attempted_at" TIMESTAMPTZ(3),
  ADD COLUMN "offboarding_cleanup_completed_at" TIMESTAMPTZ(3),
  ADD COLUMN "offboarding_cleanup_failure_code" VARCHAR(80),
  ADD COLUMN "offboarding_sessions_revoked_count" INTEGER,
  ADD COLUMN "offboarding_roles_ended_count" INTEGER,
  ADD COLUMN "offboarding_temporary_access_ended_count" INTEGER,
  ADD COLUMN "offboarding_emergency_access_ended_count" INTEGER;

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_lifecycle_version_check" CHECK ("lifecycle_version" >= 1),
  ADD CONSTRAINT "employees_offboarding_source_check" CHECK ("offboarding_source_lifecycle" IS NULL OR "offboarding_source_lifecycle" IN ('ACTIVE', 'SUSPENDED')),
  ADD CONSTRAINT "employees_offboarding_reason_check" CHECK (
    "offboarding_reason" IS NULL OR length(btrim("offboarding_reason")) BETWEEN 1 AND 500
  ),
  ADD CONSTRAINT "employees_offboarding_counts_check" CHECK (
    ("offboarding_sessions_revoked_count" IS NULL OR "offboarding_sessions_revoked_count" >= 0) AND
    ("offboarding_roles_ended_count" IS NULL OR "offboarding_roles_ended_count" >= 0) AND
    ("offboarding_temporary_access_ended_count" IS NULL OR "offboarding_temporary_access_ended_count" >= 0) AND
    ("offboarding_emergency_access_ended_count" IS NULL OR "offboarding_emergency_access_ended_count" >= 0)
  ),
  ADD CONSTRAINT "employees_offboarding_metadata_check" CHECK (
    "lifecycle_status" NOT IN ('OFFBOARDING', 'ARCHIVED') OR (
      "offboarding_at" IS NOT NULL AND
      "offboarding_source_lifecycle" IS NOT NULL AND
      "offboarding_initiated_by_employee_id" IS NOT NULL AND
      "offboarding_reason" IS NOT NULL AND
      "offboarding_approval_reference" IS NOT NULL AND
      "offboarding_cleanup_status" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "employees_archive_cleanup_check" CHECK (
    "lifecycle_status" <> 'ARCHIVED' OR (
      "archived_at" IS NOT NULL AND
      "offboarding_cleanup_status" = 'COMPLETED' AND
      "offboarding_cleanup_completed_at" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "employees_offboarding_cleanup_state_check" CHECK (
    "offboarding_cleanup_status" IS NULL OR
    ("offboarding_cleanup_status" = 'PENDING' AND "offboarding_cleanup_completed_at" IS NULL) OR
    ("offboarding_cleanup_status" = 'INCOMPLETE' AND
      "offboarding_cleanup_attempted_at" IS NOT NULL AND
      "offboarding_cleanup_completed_at" IS NULL AND
      "offboarding_cleanup_failure_code" IS NOT NULL) OR
    ("offboarding_cleanup_status" = 'COMPLETED' AND
      "offboarding_cleanup_attempted_at" IS NOT NULL AND
      "offboarding_cleanup_completed_at" IS NOT NULL AND
      "offboarding_cleanup_failure_code" IS NULL AND
      "offboarding_sessions_revoked_count" IS NOT NULL AND
      "offboarding_roles_ended_count" IS NOT NULL AND
      "offboarding_temporary_access_ended_count" IS NOT NULL AND
      "offboarding_emergency_access_ended_count" IS NOT NULL)
  );

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_offboarding_initiator_fkey"
  FOREIGN KEY ("organization_id", "offboarding_initiated_by_employee_id")
  REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employees_offboarding_approval_fkey"
  FOREIGN KEY ("organization_id", "offboarding_approval_reference")
  REFERENCES "approval_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "employees_offboarding_cleanup_idx"
  ON "employees"("organization_id", "offboarding_cleanup_status", "offboarding_at");
CREATE INDEX "employees_offboarding_initiator_idx"
  ON "employees"("organization_id", "offboarding_initiated_by_employee_id");
CREATE INDEX "employees_offboarding_approval_idx"
  ON "employees"("organization_id", "offboarding_approval_reference");
