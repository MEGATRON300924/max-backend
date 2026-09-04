CREATE TABLE "audit_events" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "correlation_id" TEXT,
  "event_type" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resource_type" TEXT,
  "resource_id" TEXT,
  "status" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_user_id_created_at_idx" ON "audit_events"("user_id", "created_at");
CREATE INDEX "audit_events_event_type_created_at_idx" ON "audit_events"("event_type", "created_at");
CREATE INDEX "audit_events_correlation_id_idx" ON "audit_events"("correlation_id");

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "ecosystem_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
