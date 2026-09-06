CREATE TYPE "emergency_access_grant_status" AS ENUM (
  'PENDING_APPROVAL',
  'ACTIVATION_ELIGIBLE',
  'ACTIVE',
  'DENIED',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE "emergency_access_grants" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "requester_employee_id" UUID NOT NULL,
  "recipient_employee_id" UUID NOT NULL,
  "requester_snapshot" JSONB NOT NULL,
  "recipient_snapshot" JSONB NOT NULL,
  "safe_reason" VARCHAR(500) NOT NULL,
  "requested_risk" "event_risk" NOT NULL,
  "effective_risk" "event_risk" NOT NULL,
  "requested_starts_at" TIMESTAMPTZ(3) NOT NULL,
  "requested_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "activated_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "emergency_access_grant_status" NOT NULL DEFAULT 'ACTIVATION_ELIGIBLE',
  "approval_reference" UUID,
  "policy_key" VARCHAR(160) NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "policy_fingerprint" CHAR(64) NOT NULL,
  "context_fingerprint" CHAR(64) NOT NULL,
  "step_up_assurance_level" VARCHAR(80) NOT NULL,
  "step_up_verified_at" TIMESTAMPTZ(3) NOT NULL,
  "denial_code" VARCHAR(80),
  "denied_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "revoked_by_employee_id" UUID,
  "idempotency_digest" CHAR(64) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "emergency_access_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "emergency_access_grants_window_check" CHECK (
    "requested_starts_at" < "requested_expires_at" AND "expires_at" = "requested_expires_at"
  ),
  CONSTRAINT "emergency_access_grants_policy_check" CHECK (
    "policy_version" > 0 AND length("policy_fingerprint") = 64 AND length("context_fingerprint") = 64
  ),
  CONSTRAINT "emergency_access_grants_state_check" CHECK (
    ("status" = 'PENDING_APPROVAL' AND "approval_reference" IS NOT NULL AND "activated_at" IS NULL AND "denied_at" IS NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
    OR ("status" = 'ACTIVATION_ELIGIBLE' AND "activated_at" IS NULL AND "denied_at" IS NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
    OR ("status" = 'ACTIVE' AND "activated_at" IS NOT NULL AND "denied_at" IS NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
    OR ("status" = 'DENIED' AND "activated_at" IS NULL AND "denial_code" IS NOT NULL AND "denied_at" IS NOT NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
    OR ("status" = 'REVOKED' AND "denied_at" IS NULL AND "revoked_at" IS NOT NULL AND "revoked_by_employee_id" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "activated_at" IS NOT NULL AND "denied_at" IS NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
  )
);

CREATE TABLE "emergency_access_bindings" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "emergency_access_grant_id" UUID NOT NULL,
  "permission_key" VARCHAR(160) NOT NULL,
  "permission_risk_snapshot" "event_risk" NOT NULL,
  "scope_type" "scope_type" NOT NULL,
  "scope_binding_type" VARCHAR(80),
  "scope_binding_id" VARCHAR(128),
  "resource_type" VARCHAR(80) NOT NULL,
  "resource_id" VARCHAR(128),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "emergency_access_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "emergency_access_bindings_pair_check" CHECK (("scope_binding_type" IS NULL) = ("scope_binding_id" IS NULL)),
  CONSTRAINT "emergency_access_bindings_scope_check" CHECK (
    ("scope_type" = 'ORGANIZATION' AND "scope_binding_type" IS NULL AND "scope_binding_id" IS NULL AND "resource_id" IS NULL)
    OR ("scope_type" = 'EXPLICIT' AND "scope_binding_type" = "resource_type" AND "scope_binding_id" = "resource_id" AND "resource_id" IS NOT NULL)
    OR ("scope_type" IN ('ASSIGNED', 'TEAM', 'DEPARTMENT', 'PROJECT', 'CUSTOMER') AND "scope_binding_type" = "resource_type" AND "scope_binding_id" = "resource_id" AND "resource_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "emergency_access_grants_organization_id_id_key" ON "emergency_access_grants"("organization_id", "id");
CREATE UNIQUE INDEX "emergency_access_grants_organization_idempotency_key" ON "emergency_access_grants"("organization_id", "idempotency_digest");
CREATE INDEX "emergency_access_grants_recipient_effective_idx" ON "emergency_access_grants"("organization_id", "recipient_employee_id", "status", "requested_starts_at", "expires_at");
CREATE INDEX "emergency_access_grants_requester_created_idx" ON "emergency_access_grants"("organization_id", "requester_employee_id", "created_at");
CREATE INDEX "emergency_access_grants_expiry_idx" ON "emergency_access_grants"("status", "expires_at", "id");
CREATE INDEX "emergency_access_grants_approval_idx" ON "emergency_access_grants"("organization_id", "approval_reference");
CREATE UNIQUE INDEX "emergency_access_bindings_unique_key" ON "emergency_access_bindings"("organization_id", "emergency_access_grant_id", "permission_key", "scope_type", "scope_binding_type", "scope_binding_id", "resource_type", "resource_id");
CREATE INDEX "emergency_access_bindings_grant_idx" ON "emergency_access_bindings"("organization_id", "emergency_access_grant_id");
CREATE INDEX "emergency_access_bindings_permission_scope_idx" ON "emergency_access_bindings"("organization_id", "permission_key", "scope_type");

ALTER TABLE "emergency_access_grants" ADD CONSTRAINT "emergency_access_grants_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "emergency_access_grants" ADD CONSTRAINT "emergency_access_grants_requester_fkey" FOREIGN KEY ("organization_id", "requester_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "emergency_access_grants" ADD CONSTRAINT "emergency_access_grants_recipient_fkey" FOREIGN KEY ("organization_id", "recipient_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "emergency_access_grants" ADD CONSTRAINT "emergency_access_grants_revoker_fkey" FOREIGN KEY ("organization_id", "revoked_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "emergency_access_grants" ADD CONSTRAINT "emergency_access_grants_approval_fkey" FOREIGN KEY ("organization_id", "approval_reference") REFERENCES "approval_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "emergency_access_bindings" ADD CONSTRAINT "emergency_access_bindings_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "emergency_access_bindings" ADD CONSTRAINT "emergency_access_bindings_grant_fkey" FOREIGN KEY ("organization_id", "emergency_access_grant_id") REFERENCES "emergency_access_grants"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "emergency_access_bindings" ADD CONSTRAINT "emergency_access_bindings_permission_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE RESTRICT;
