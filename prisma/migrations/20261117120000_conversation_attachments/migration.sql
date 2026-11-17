CREATE TABLE "max_backend"."conversation_attachments" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "message_id" UUID,
  "public_id" TEXT NOT NULL,
  "secure_url" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_attachments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversation_attachments_public_id_key" ON "max_backend"."conversation_attachments"("public_id");
CREATE INDEX "conversation_attachments_user_id_conversation_id_created_at_idx" ON "max_backend"."conversation_attachments"("user_id", "conversation_id", "created_at");
CREATE INDEX "conversation_attachments_message_id_idx" ON "max_backend"."conversation_attachments"("message_id");
ALTER TABLE "max_backend"."conversation_attachments" ADD CONSTRAINT "conversation_attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_backend"."conversation_attachments" ADD CONSTRAINT "conversation_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "max_backend"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_backend"."conversation_attachments" ADD CONSTRAINT "conversation_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "max_backend"."messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
