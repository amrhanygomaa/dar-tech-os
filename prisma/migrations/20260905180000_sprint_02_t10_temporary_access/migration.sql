CREATE TYPE "temporary_access_grant_status" AS ENUM (
  'PENDING_APPROVAL',
  'GRANTED',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE "temporary_access_grants" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "issuer_employee_id" UUID NOT NULL,
  "recipient_employee_id" UUID NOT NULL,
  "issuer_snapshot" JSONB NOT NULL,
  "recipient_snapshot" JSONB NOT NULL,
  "safe_reason" VARCHAR(500) NOT NULL,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "temporary_access_grant_status" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "approval_reference" UUID,
  "idempotency_digest" CHAR(64) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "context_fingerprint" CHAR(64) NOT NULL,
  "requested_at" TIMESTAMPTZ(3) NOT NULL,
  "granted_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "revoked_by_employee_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "temporary_access_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "temporary_access_grants_window_check" CHECK ("starts_at" < "expires_at"),
  CONSTRAINT "temporary_access_grants_terminal_check" CHECK (
    ("status" = 'PENDING_APPROVAL' AND "granted_at" IS NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
    OR ("status" = 'GRANTED' AND "granted_at" IS NOT NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
    OR ("status" = 'REVOKED' AND "granted_at" IS NOT NULL AND "revoked_at" IS NOT NULL AND "revoked_by_employee_id" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "granted_at" IS NOT NULL AND "revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL)
  )
);

CREATE TABLE "temporary_access_bindings" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "temporary_access_grant_id" UUID NOT NULL,
  "permission_key" VARCHAR(160) NOT NULL,
  "permission_risk_snapshot" "event_risk" NOT NULL,
  "scope_type" "scope_type" NOT NULL,
  "scope_binding_type" VARCHAR(80),
  "scope_binding_id" VARCHAR(128),
  "resource_type" VARCHAR(80) NOT NULL,
  "resource_id" VARCHAR(128),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "temporary_access_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "temporary_access_bindings_pair_check" CHECK (("scope_binding_type" IS NULL) = ("scope_binding_id" IS NULL)),
  CONSTRAINT "temporary_access_bindings_scope_check" CHECK (
    ("scope_type" = 'ORGANIZATION' AND "scope_binding_type" IS NULL AND "scope_binding_id" IS NULL AND "resource_id" IS NULL)
    OR ("scope_type" = 'EXPLICIT' AND "scope_binding_type" = "resource_type" AND "scope_binding_id" = "resource_id" AND "resource_id" IS NOT NULL)
    OR ("scope_type" IN ('ASSIGNED', 'TEAM', 'DEPARTMENT', 'PROJECT', 'CUSTOMER') AND "scope_binding_type" = "resource_type" AND "scope_binding_id" = "resource_id" AND "resource_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "temporary_access_grants_organization_id_id_key" ON "temporary_access_grants"("organization_id", "id");
CREATE UNIQUE INDEX "temporary_access_grants_organization_idempotency_key" ON "temporary_access_grants"("organization_id", "idempotency_digest");
CREATE INDEX "temporary_access_grants_recipient_effective_idx" ON "temporary_access_grants"("organization_id", "recipient_employee_id", "status", "starts_at", "expires_at");
CREATE INDEX "temporary_access_grants_issuer_created_idx" ON "temporary_access_grants"("organization_id", "issuer_employee_id", "created_at");
CREATE INDEX "temporary_access_grants_expiry_idx" ON "temporary_access_grants"("status", "expires_at", "id");
CREATE INDEX "temporary_access_grants_approval_idx" ON "temporary_access_grants"("organization_id", "approval_reference");
CREATE UNIQUE INDEX "temporary_access_bindings_unique_key" ON "temporary_access_bindings"("organization_id", "temporary_access_grant_id", "permission_key", "scope_type", "scope_binding_type", "scope_binding_id", "resource_type", "resource_id");
CREATE INDEX "temporary_access_bindings_grant_idx" ON "temporary_access_bindings"("organization_id", "temporary_access_grant_id");
CREATE INDEX "temporary_access_bindings_permission_scope_idx" ON "temporary_access_bindings"("organization_id", "permission_key", "scope_type");

ALTER TABLE "temporary_access_grants" ADD CONSTRAINT "temporary_access_grants_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "temporary_access_grants" ADD CONSTRAINT "temporary_access_grants_issuer_fkey" FOREIGN KEY ("organization_id", "issuer_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "temporary_access_grants" ADD CONSTRAINT "temporary_access_grants_recipient_fkey" FOREIGN KEY ("organization_id", "recipient_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "temporary_access_grants" ADD CONSTRAINT "temporary_access_grants_revoker_fkey" FOREIGN KEY ("organization_id", "revoked_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "temporary_access_grants" ADD CONSTRAINT "temporary_access_grants_approval_fkey" FOREIGN KEY ("organization_id", "approval_reference") REFERENCES "approval_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "temporary_access_bindings" ADD CONSTRAINT "temporary_access_bindings_organization_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "temporary_access_bindings" ADD CONSTRAINT "temporary_access_bindings_grant_fkey" FOREIGN KEY ("organization_id", "temporary_access_grant_id") REFERENCES "temporary_access_grants"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "temporary_access_bindings" ADD CONSTRAINT "temporary_access_bindings_permission_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE RESTRICT;
