CREATE TABLE IF NOT EXISTS "max_backend"."discord_channel_configs" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "configured_by_discord_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "discord_channel_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "discord_channel_configs_guild_id_channel_id_key"
  ON "max_backend"."discord_channel_configs"("guild_id", "channel_id");
CREATE INDEX IF NOT EXISTS "discord_channel_configs_guild_id_enabled_idx"
  ON "max_backend"."discord_channel_configs"("guild_id", "enabled");
