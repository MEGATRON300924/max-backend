ALTER TABLE "max_backend"."pending_actions"
  ADD COLUMN IF NOT EXISTS "conversation_id" UUID,
  ADD COLUMN IF NOT EXISTS "interaction_id" TEXT,
  ADD COLUMN IF NOT EXISTS "call_id" TEXT;

UPDATE "max_backend"."pending_actions" AS pa
SET
  "conversation_id" = COALESCE(pa."conversation_id", (
    SELECT c."id"
    FROM "max_backend"."conversations" AS c
    WHERE c."user_id" = pa."user_id"
    ORDER BY c."updated_at" DESC
    LIMIT 1
  )),
  "interaction_id" = COALESCE(pa."interaction_id", 'legacy-' || pa."id"),
  "call_id" = COALESCE(pa."call_id", 'legacy-' || pa."id")
WHERE pa."conversation_id" IS NULL
   OR pa."interaction_id" IS NULL
   OR pa."call_id" IS NULL;

ALTER TABLE "max_backend"."pending_actions"
  ALTER COLUMN "conversation_id" SET NOT NULL,
  ALTER COLUMN "interaction_id" SET NOT NULL,
  ALTER COLUMN "call_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pending_actions_conversation_id_fkey'
      AND conrelid = 'max_backend.pending_actions'::regclass
  ) THEN
    ALTER TABLE "max_backend"."pending_actions"
      ADD CONSTRAINT "pending_actions_conversation_id_fkey"
      FOREIGN KEY ("conversation_id")
      REFERENCES "max_backend"."conversations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pending_actions_conversation_id_status_idx"
  ON "max_backend"."pending_actions"("conversation_id", "status");
