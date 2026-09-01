-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "queue_job_status" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "outbox_event_status" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "queue_jobs" (
    "id" UUID NOT NULL,
    "queue" VARCHAR(64) NOT NULL DEFAULT 'default',
    "name" VARCHAR(160) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "organization_id" UUID,
    "correlation_id" VARCHAR(128) NOT NULL,
    "causation_id" VARCHAR(128),
    "deduplication_key" VARCHAR(255),
    "deduplication_hash" CHAR(64),
    "status" "queue_job_status" NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "locked_by" VARCHAR(128),
    "lease_token" UUID,
    "locked_at" TIMESTAMPTZ(3),
    "lock_expires_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(128),
    "last_error_message" VARCHAR(2048),
    "completed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "queue_jobs_version_positive" CHECK ("version" > 0),
    CONSTRAINT "queue_jobs_attempt_count_nonnegative" CHECK ("attempt_count" >= 0),
    CONSTRAINT "queue_jobs_max_attempts_positive" CHECK ("max_attempts" > 0),
    CONSTRAINT "queue_jobs_deduplication_pair" CHECK (
        ("deduplication_key" IS NULL) = ("deduplication_hash" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(200) NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "organization_id" UUID,
    "correlation_id" VARCHAR(128) NOT NULL,
    "causation_id" VARCHAR(128),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "outbox_event_status" NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "locked_by" VARCHAR(128),
    "lease_token" UUID,
    "locked_at" TIMESTAMPTZ(3),
    "lock_expires_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(128),
    "last_error_message" VARCHAR(2048),
    "processed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_event_version_positive" CHECK ("event_version" > 0),
    CONSTRAINT "outbox_events_attempt_count_nonnegative" CHECK ("attempt_count" >= 0),
    CONSTRAINT "outbox_events_max_attempts_positive" CHECK ("max_attempts" > 0)
);

-- CreateTable
CREATE TABLE "outbox_consumer_receipts" (
    "event_id" UUID NOT NULL,
    "consumer_name" VARCHAR(160) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_consumer_receipts_pkey" PRIMARY KEY ("event_id", "consumer_name")
);

-- CreateIndex
CREATE INDEX "queue_jobs_claim_idx" ON "queue_jobs"("queue", "status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "queue_jobs_expired_lease_idx" ON "queue_jobs"("status", "lock_expires_at");

-- CreateIndex
CREATE INDEX "queue_jobs_correlation_id_idx" ON "queue_jobs"("correlation_id");

-- CreateIndex
CREATE INDEX "queue_jobs_organization_created_at_idx" ON "queue_jobs"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "queue_jobs_queue_deduplication_key" ON "queue_jobs"("queue", "deduplication_key");

-- CreateIndex
CREATE INDEX "outbox_events_claim_idx" ON "outbox_events"("status", "available_at", "occurred_at");

-- CreateIndex
CREATE INDEX "outbox_events_expired_lease_idx" ON "outbox_events"("status", "lock_expires_at");

-- CreateIndex
CREATE INDEX "outbox_events_correlation_id_idx" ON "outbox_events"("correlation_id");

-- CreateIndex
CREATE INDEX "outbox_events_organization_created_at_idx" ON "outbox_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_consumer_receipts_consumer_processed_idx" ON "outbox_consumer_receipts"("consumer_name", "processed_at");

-- AddForeignKey
ALTER TABLE "outbox_consumer_receipts"
ADD CONSTRAINT "outbox_consumer_receipts_event_id_fkey"
FOREIGN KEY ("event_id") REFERENCES "outbox_events"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
