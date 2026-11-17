DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend'
      AND t.typname = 'PendingActionStatus'
      AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."PendingActionStatus" AS ENUM (''PENDING'', ''CONFIRMED'', ''CANCELLED'', ''EXPIRED'')';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "max_backend"."pending_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "tool_name" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" "max_backend"."PendingActionStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pending_actions_user_id_status_expires_at_idx"
  ON "max_backend"."pending_actions"("user_id", "status", "expires_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pending_actions_user_id_fkey'
      AND conrelid = 'max_backend.pending_actions'::regclass
  ) THEN
    ALTER TABLE "max_backend"."pending_actions"
      ADD CONSTRAINT "pending_actions_user_id_fkey"
      FOREIGN KEY ("user_id")
      REFERENCES "max_backend"."ecosystem_users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
