CREATE TABLE IF NOT EXISTS "max_backend"."audit_events" (
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

CREATE INDEX IF NOT EXISTS "audit_events_user_id_created_at_idx"
  ON "max_backend"."audit_events"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_event_type_created_at_idx"
  ON "max_backend"."audit_events"("event_type", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_correlation_id_idx"
  ON "max_backend"."audit_events"("correlation_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_events_user_id_fkey'
      AND conrelid = 'max_backend.audit_events'::regclass
  ) THEN
    ALTER TABLE "max_backend"."audit_events"
      ADD CONSTRAINT "audit_events_user_id_fkey"
      FOREIGN KEY ("user_id")
      REFERENCES "max_backend"."ecosystem_users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
