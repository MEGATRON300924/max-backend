CREATE TABLE "max_backend"."project_workspaces" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "conversation_id" UUID,
  "name" VARCHAR(100) NOT NULL,
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "max_backend"."project_files" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "path" VARCHAR(240) NOT NULL,
  "content" TEXT NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_workspaces_user_id_last_activity_at_idx" ON "max_backend"."project_workspaces"("user_id", "last_activity_at");
CREATE INDEX "project_workspaces_expires_at_idx" ON "max_backend"."project_workspaces"("expires_at");
CREATE INDEX "project_workspaces_conversation_id_idx" ON "max_backend"."project_workspaces"("conversation_id");
CREATE UNIQUE INDEX "project_files_workspace_id_path_key" ON "max_backend"."project_files"("workspace_id", "path");
CREATE INDEX "project_files_workspace_id_updated_at_idx" ON "max_backend"."project_files"("workspace_id", "updated_at");

ALTER TABLE "max_backend"."project_workspaces"
  ADD CONSTRAINT "project_workspaces_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_backend"."project_workspaces"
  ADD CONSTRAINT "project_workspaces_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "max_backend"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_backend"."project_files"
  ADD CONSTRAINT "project_files_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "max_backend"."project_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
