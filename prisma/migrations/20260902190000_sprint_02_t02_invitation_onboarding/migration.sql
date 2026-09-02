-- S02-T02 is additive: it introduces invitation lifecycle storage without
-- changing or deleting any existing identity or history record.
CREATE TYPE "invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "invited_email_normalized" VARCHAR(320) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'PENDING',
    "issuer_employee_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_employee_id" UUID,
    "safe_revocation_reason" VARCHAR(500),
    "onboarding_completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_expiry_after_issue_check" CHECK ("expires_at" > "issued_at"),
    CONSTRAINT "invitations_email_normalized_check" CHECK (
      "invited_email_normalized" = lower(btrim("invited_email_normalized"))
      AND length("invited_email_normalized") > 0
    ),
    CONSTRAINT "invitations_token_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "invitations_status_metadata_check" CHECK (
      (
        "status" = 'PENDING'
        AND "accepted_at" IS NULL
        AND "revoked_at" IS NULL
        AND "revoked_by_employee_id" IS NULL
        AND "safe_revocation_reason" IS NULL
        AND "onboarding_completed_at" IS NULL
      ) OR (
        "status" = 'ACCEPTED'
        AND "accepted_at" IS NOT NULL
        AND "revoked_at" IS NULL
        AND "revoked_by_employee_id" IS NULL
        AND "safe_revocation_reason" IS NULL
        AND "onboarding_completed_at" IS NOT NULL
      ) OR (
        "status" = 'REVOKED'
        AND "accepted_at" IS NULL
        AND "revoked_at" IS NOT NULL
        AND "revoked_by_employee_id" IS NOT NULL
        AND "onboarding_completed_at" IS NULL
      ) OR (
        "status" = 'EXPIRED'
        AND "accepted_at" IS NULL
        AND "revoked_at" IS NULL
        AND "revoked_by_employee_id" IS NULL
        AND "safe_revocation_reason" IS NULL
        AND "onboarding_completed_at" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE UNIQUE INDEX "invitations_organization_id_id_key" ON "invitations"("organization_id", "id");
CREATE UNIQUE INDEX "invitations_organization_employee_id_key" ON "invitations"("organization_id", "employee_id");
CREATE UNIQUE INDEX "invitations_organization_account_id_key" ON "invitations"("organization_id", "user_account_id");
CREATE INDEX "invitations_organization_status_created_at_idx" ON "invitations"("organization_id", "status", "created_at");
CREATE INDEX "invitations_status_expires_at_idx" ON "invitations"("status", "expires_at");
CREATE INDEX "invitations_organization_expires_at_idx" ON "invitations"("organization_id", "expires_at");
CREATE INDEX "invitations_organization_issuer_idx" ON "invitations"("organization_id", "issuer_employee_id");
CREATE INDEX "invitations_organization_revoker_idx" ON "invitations"("organization_id", "revoked_by_employee_id");

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_employee_id_fkey"
  FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_user_account_id_fkey"
  FOREIGN KEY ("organization_id", "user_account_id") REFERENCES "user_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_issuer_employee_id_fkey"
  FOREIGN KEY ("organization_id", "issuer_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_revoked_by_employee_id_fkey"
  FOREIGN KEY ("organization_id", "revoked_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
