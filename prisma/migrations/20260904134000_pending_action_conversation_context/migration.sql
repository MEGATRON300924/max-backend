ALTER TABLE "pending_actions"
  ADD COLUMN IF NOT EXISTS "conversation_id" UUID,
  ADD COLUMN IF NOT EXISTS "interaction_id" TEXT,
  ADD COLUMN IF NOT EXISTS "call_id" TEXT;

UPDATE "pending_actions"
SET
  "conversation_id" = COALESCE("conversation_id", (
    SELECT "id" FROM "conversations" WHERE "user_id" = "pending_actions"."user_id" ORDER BY "updated_at" DESC LIMIT 1
  )),
  "interaction_id" = COALESCE("interaction_id", 'legacy-' || "id"),
  "call_id" = COALESCE("call_id", 'legacy-' || "id")
WHERE "conversation_id" IS NULL OR "interaction_id" IS NULL OR "call_id" IS NULL;

ALTER TABLE "pending_actions"
  ALTER COLUMN "conversation_id" SET NOT NULL,
  ALTER COLUMN "interaction_id" SET NOT NULL,
  ALTER COLUMN "call_id" SET NOT NULL;

ALTER TABLE "pending_actions"
  ADD CONSTRAINT "pending_actions_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "pending_actions_conversation_id_status_idx"
  ON "pending_actions"("conversation_id", "status");
