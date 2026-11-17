CREATE TABLE "max_backend"."cloud_files" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "original_name" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cloud_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cloud_files_storage_key_key" ON "max_backend"."cloud_files"("storage_key");
CREATE INDEX "cloud_files_user_id_created_at_idx" ON "max_backend"."cloud_files"("user_id", "created_at");
ALTER TABLE "max_backend"."cloud_files" ADD CONSTRAINT "cloud_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
