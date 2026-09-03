-- S02-T04 adds opaque, server-side browser session persistence without storing raw credentials.
CREATE TYPE "session_client_kind" AS ENUM ('BROWSER');

CREATE UNIQUE INDEX "user_accounts_organization_id_employee_id_key"
ON "user_accounts"("organization_id", "id", "employee_id");

CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "credential_hash" CHAR(64) NOT NULL,
    "client_kind" "session_client_kind" NOT NULL DEFAULT 'BROWSER',
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "authenticated_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_employee_id" UUID,
    "safe_revocation_reason" VARCHAR(500),
    "assurance_level" VARCHAR(80),
    "last_step_up_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_expiry_order_check" CHECK (
      "issued_at" <= "last_seen_at"
      AND "last_seen_at" <= "idle_expires_at"
      AND "idle_expires_at" <= "absolute_expires_at"
    ),
    CONSTRAINT "sessions_revocation_shape_check" CHECK (
      ("revoked_at" IS NULL AND "revoked_by_employee_id" IS NULL AND "safe_revocation_reason" IS NULL)
      OR "revoked_at" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "sessions_credential_hash_key" ON "sessions"("credential_hash");
CREATE UNIQUE INDEX "sessions_organization_id_id_key" ON "sessions"("organization_id", "id");
CREATE INDEX "sessions_organization_account_issued_at_idx" ON "sessions"("organization_id", "user_account_id", "issued_at");
CREATE INDEX "sessions_organization_employee_issued_at_idx" ON "sessions"("organization_id", "employee_id", "issued_at");
CREATE INDEX "sessions_organization_revoked_issued_at_idx" ON "sessions"("organization_id", "revoked_at", "issued_at");
CREATE INDEX "sessions_idle_expires_at_idx" ON "sessions"("idle_expires_at");
CREATE INDEX "sessions_absolute_expires_at_idx" ON "sessions"("absolute_expires_at");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_employee_id_fkey"
FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_user_account_id_employee_id_fkey"
FOREIGN KEY ("organization_id", "user_account_id", "employee_id") REFERENCES "user_accounts"("organization_id", "id", "employee_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_revoked_by_employee_id_fkey"
FOREIGN KEY ("organization_id", "revoked_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
