-- S02-T06 adds the product-global permission registry and organization-owned
-- historical role grants. Existing history is preserved and all relations are
-- restrictive. Scope bindings are storage contracts only; no resolver is added.
CREATE TYPE "scope_type" AS ENUM (
  'SELF',
  'ASSIGNED',
  'TEAM',
  'DEPARTMENT',
  'PROJECT',
  'CUSTOMER',
  'ORGANIZATION',
  'EXPLICIT'
);

CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(160) NOT NULL,
    "domain" VARCHAR(64) NOT NULL,
    "resource" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "risk_classification" "event_risk" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deprecated_at" TIMESTAMPTZ(3),
    "replacement_permission_key" VARCHAR(160),
    "definition_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "permissions_key_format_check" CHECK (
      "key" = lower(btrim("key"))
      AND "key" ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
      AND "key" = "domain" || '.' || "resource" || '.' || "action"
    ),
    CONSTRAINT "permissions_segments_format_check" CHECK (
      "domain" ~ '^[a-z][a-z0-9_]*$'
      AND "resource" ~ '^[a-z][a-z0-9_]*$'
      AND "action" ~ '^[a-z][a-z0-9_]*$'
    ),
    CONSTRAINT "permissions_description_check" CHECK (length(btrim("description")) > 0),
    CONSTRAINT "permissions_definition_version_check" CHECK ("definition_version" > 0),
    CONSTRAINT "permissions_deprecation_state_check" CHECK (
      "deprecated_at" IS NULL OR "active" = false
    ),
    CONSTRAINT "permissions_replacement_state_check" CHECK (
      "replacement_permission_key" IS NULL
      OR ("deprecated_at" IS NOT NULL AND "replacement_permission_key" <> "key")
    )
);

CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "scope_type" "scope_type" NOT NULL,
    "scope_binding_type" VARCHAR(80),
    "scope_binding_id" VARCHAR(128),
    "granted_by_employee_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),
    "removed_by_employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "role_permissions_expiry_after_effective_check" CHECK (
      "expires_at" IS NULL OR "expires_at" > "effective_at"
    ),
    CONSTRAINT "role_permissions_removal_metadata_check" CHECK (
      ("removed_at" IS NULL AND "removed_by_employee_id" IS NULL)
      OR ("removed_at" IS NOT NULL AND "removed_by_employee_id" IS NOT NULL)
    ),
    CONSTRAINT "role_permissions_binding_pair_check" CHECK (
      ("scope_binding_type" IS NULL AND "scope_binding_id" IS NULL)
      OR ("scope_binding_type" IS NOT NULL AND "scope_binding_id" IS NOT NULL)
    ),
    CONSTRAINT "role_permissions_scope_binding_check" CHECK (
      ("scope_type" IN ('SELF', 'ORGANIZATION')
        AND "scope_binding_type" IS NULL AND "scope_binding_id" IS NULL)
      OR ("scope_type" = 'EXPLICIT'
        AND "scope_binding_type" IS NOT NULL AND "scope_binding_id" IS NOT NULL)
      OR "scope_type" IN ('ASSIGNED', 'TEAM', 'DEPARTMENT', 'PROJECT', 'CUSTOMER')
    ),
    CONSTRAINT "role_permissions_binding_format_check" CHECK (
      "scope_binding_type" IS NULL
      OR (
        "scope_binding_type" ~ '^[a-z][a-z0-9._-]*$'
        AND "scope_binding_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      )
    )
);

CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");
CREATE INDEX "permissions_domain_resource_action_idx" ON "permissions"("domain", "resource", "action");
CREATE INDEX "permissions_active_deprecated_idx" ON "permissions"("active", "deprecated_at");

CREATE UNIQUE INDEX "role_permissions_organization_id_id_key" ON "role_permissions"("organization_id", "id");
CREATE INDEX "role_permissions_role_permission_effective_idx" ON "role_permissions"("organization_id", "role_id", "permission_id", "effective_at");
CREATE INDEX "role_permissions_role_effective_lookup_idx" ON "role_permissions"("organization_id", "role_id", "removed_at", "expires_at");
CREATE INDEX "role_permissions_permission_effective_idx" ON "role_permissions"("permission_id", "removed_at", "expires_at");
CREATE INDEX "role_permissions_organization_grantor_idx" ON "role_permissions"("organization_id", "granted_by_employee_id");
CREATE INDEX "role_permissions_organization_remover_idx" ON "role_permissions"("organization_id", "removed_by_employee_id");

ALTER TABLE "permissions" ADD CONSTRAINT "permissions_replacement_permission_key_fkey"
  FOREIGN KEY ("replacement_permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_role_id_fkey"
  FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_granted_by_employee_id_fkey"
  FOREIGN KEY ("organization_id", "granted_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_removed_by_employee_id_fkey"
  FOREIGN KEY ("organization_id", "removed_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permission keys are stable external security identities. Safe registry sync may
-- maintain approved metadata, but a key rename requires a reviewed migration.
CREATE FUNCTION "prevent_permission_key_change"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."key" <> OLD."key" THEN
    RAISE EXCEPTION 'permission keys are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "permissions_key_immutable"
BEFORE UPDATE ON "permissions"
FOR EACH ROW EXECUTE FUNCTION "prevent_permission_key_change"();

-- Product-global registry registration has no organization or fabricated
-- employee owner. T12 accepts only this narrowly bounded system audit case.
ALTER TABLE "audit_events" ALTER COLUMN "organization_id" DROP NOT NULL;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_global_system_scope_check" CHECK (
  "organization_id" IS NOT NULL
  OR (
    "actor_employee_id" IS NULL
    AND "action_key" = 'system.permission.register'
    AND "target_type" = 'permission'
    AND "actor_snapshot"->>'type' = 'system'
  )
);
