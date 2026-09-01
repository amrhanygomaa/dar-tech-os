-- CreateEnum
CREATE TYPE "employee_lifecycle_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'ARCHIVED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_code" VARCHAR(64) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "work_email" VARCHAR(320) NOT NULL,
    "lifecycle_status" "employee_lifecycle_status" NOT NULL DEFAULT 'INVITED',
    "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),
    "suspended_at" TIMESTAMPTZ(3),
    "offboarding_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "authentication_eligible" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" TIMESTAMPTZ(3),
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_identities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "provider_key" VARCHAR(64) NOT NULL,
    "provider_subject" VARCHAR(255) NOT NULL,
    "verified_email_normalized" VARCHAR(320),
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_authenticated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_organization_lifecycle_created_at_idx" ON "employees"("organization_id", "lifecycle_status", "created_at");

-- CreateIndex
CREATE INDEX "employees_organization_work_email_idx" ON "employees"("organization_id", "work_email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_id_key" ON "employees"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_employee_code_key" ON "employees"("organization_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_employee_id_key" ON "user_accounts"("employee_id");

-- CreateIndex
CREATE INDEX "user_accounts_organization_authentication_eligible_idx" ON "user_accounts"("organization_id", "authentication_eligible");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_organization_id_id_key" ON "user_accounts"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_organization_employee_id_key" ON "user_accounts"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "sso_identities_organization_account_idx" ON "sso_identities"("organization_id", "user_account_id");

-- CreateIndex
CREATE INDEX "sso_identities_organization_verified_email_idx" ON "sso_identities"("organization_id", "verified_email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "sso_identities_provider_subject_key" ON "sso_identities"("provider_key", "provider_subject");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_identities" ADD CONSTRAINT "sso_identities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_identities" ADD CONSTRAINT "sso_identities_organization_id_user_account_id_fkey" FOREIGN KEY ("organization_id", "user_account_id") REFERENCES "user_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
