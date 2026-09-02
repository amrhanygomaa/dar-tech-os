-- S02-T05 is additive. Roles and historical employee-role assignments are
-- organization-scoped and all lifetime relations remain restrictive.
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "normalized_name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "roles_key_normalized_check" CHECK (
      "role_key" = lower(btrim("role_key"))
      AND "role_key" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
    ),
    CONSTRAINT "roles_name_normalized_check" CHECK (
      length(btrim("name")) > 0
      AND "normalized_name" = lower(btrim("normalized_name"))
      AND length("normalized_name") > 0
    )
);

CREATE TABLE "employee_roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by_employee_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),
    "removed_by_employee_id" UUID,
    "safe_removal_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_roles_expiry_after_effective_check" CHECK (
      "expires_at" IS NULL OR "expires_at" > "effective_at"
    ),
    CONSTRAINT "employee_roles_removal_metadata_check" CHECK (
      ("removed_at" IS NULL AND "removed_by_employee_id" IS NULL AND "safe_removal_reason" IS NULL)
      OR ("removed_at" IS NOT NULL AND "removed_by_employee_id" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "roles_organization_id_id_key" ON "roles"("organization_id", "id");
CREATE UNIQUE INDEX "roles_organization_role_key_key" ON "roles"("organization_id", "role_key");
CREATE UNIQUE INDEX "roles_organization_normalized_name_key" ON "roles"("organization_id", "normalized_name");
CREATE INDEX "roles_organization_archived_name_idx" ON "roles"("organization_id", "archived_at", "name");

CREATE UNIQUE INDEX "employee_roles_organization_id_id_key" ON "employee_roles"("organization_id", "id");
CREATE INDEX "employee_roles_organization_employee_effective_idx" ON "employee_roles"("organization_id", "employee_id", "effective_at");
CREATE INDEX "employee_roles_organization_role_effective_idx" ON "employee_roles"("organization_id", "role_id", "effective_at");
CREATE INDEX "employee_roles_effective_lookup_idx" ON "employee_roles"("organization_id", "employee_id", "role_id", "removed_at", "expires_at");
CREATE INDEX "employee_roles_organization_assigner_idx" ON "employee_roles"("organization_id", "assigned_by_employee_id");
CREATE INDEX "employee_roles_organization_remover_idx" ON "employee_roles"("organization_id", "removed_by_employee_id");

ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_organization_id_employee_id_fkey"
  FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_organization_id_role_id_fkey"
  FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_organization_id_assigned_by_employee_id_fkey"
  FOREIGN KEY ("organization_id", "assigned_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_organization_id_removed_by_employee_id_fkey"
  FOREIGN KEY ("organization_id", "removed_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
