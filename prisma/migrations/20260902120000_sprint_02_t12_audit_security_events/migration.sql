-- CreateEnum
CREATE TYPE "event_risk" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "action_key" VARCHAR(160) NOT NULL,
    "actor_employee_id" UUID,
    "actor_snapshot" JSONB NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(128) NOT NULL,
    "target_snapshot" JSONB,
    "request_id" VARCHAR(128),
    "correlation_id" VARCHAR(128) NOT NULL,
    "session_reference" VARCHAR(128),
    "safe_reason" VARCHAR(1024),
    "change_delta" JSONB,
    "approval_reference" VARCHAR(128),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "integrity_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_events_event_version_check" CHECK ("event_version" > 0),
    CONSTRAINT "audit_events_integrity_version_check" CHECK ("integrity_version" > 0)
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "event_type" VARCHAR(160) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "risk" "event_risk" NOT NULL,
    "outcome" VARCHAR(64) NOT NULL,
    "actor_employee_id" UUID,
    "actor_account_id" UUID,
    "provider_key" VARCHAR(64),
    "session_reference" VARCHAR(128),
    "actor_snapshot" JSONB,
    "safe_context" JSONB,
    "request_id" VARCHAR(128),
    "correlation_id" VARCHAR(128) NOT NULL,
    "network_context" JSONB,
    "device_context" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "security_events_event_version_check" CHECK ("event_version" > 0),
    CONSTRAINT "security_events_actor_scope_check" CHECK (
        "organization_id" IS NOT NULL
        OR ("actor_employee_id" IS NULL AND "actor_account_id" IS NULL)
    )
);

-- CreateIndex
CREATE INDEX "audit_events_organization_occurred_at_idx" ON "audit_events"("organization_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_events_organization_action_occurred_idx" ON "audit_events"("organization_id", "action_key", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_organization_target_idx" ON "audit_events"("organization_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "security_events_organization_occurred_at_idx" ON "security_events"("organization_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "security_events_organization_type_occurred_idx" ON "security_events"("organization_id", "event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "security_events_organization_classification_idx" ON "security_events"("organization_id", "category", "risk", "outcome");

-- CreateIndex
CREATE INDEX "security_events_unresolved_occurred_at_idx" ON "security_events"("occurred_at", "id");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_actor_employee_id_fkey" FOREIGN KEY ("organization_id", "actor_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_organization_id_actor_employee_id_fkey" FOREIGN KEY ("organization_id", "actor_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_organization_id_actor_account_id_fkey" FOREIGN KEY ("organization_id", "actor_account_id") REFERENCES "user_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only database boundary. TRUNCATE remains an operations-only mechanism for
-- controlled test reset and any future supervisor-approved retention procedure.
CREATE FUNCTION "prevent_event_history_mutation"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'historical event records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_event_history_mutation"();

CREATE TRIGGER "security_events_append_only"
BEFORE UPDATE OR DELETE ON "security_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_event_history_mutation"();
