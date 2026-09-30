CREATE TYPE "DeviceType" AS ENUM ('MOBILE', 'TABLET', 'TV', 'DESKTOP', 'SPEAKER', 'CAR', 'OTHER');
CREATE TYPE "DeviceSessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "MaxEventType" AS ENUM ('ANNOUNCEMENT', 'BROADCAST', 'SECURITY_ALERT', 'COMMAND', 'MEDIA_ACTION', 'NOTIFICATION', 'AUTOMATION_EVENT', 'DEVICE_CHANGED', 'ACCOUNT_UPDATED', 'SUBSCRIPTION_UPDATED');
CREATE TYPE "EventPriority" AS ENUM ('INFO', 'NORMAL', 'IMPORTANT', 'CRITICAL');

CREATE TABLE "devices" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "device_type" "DeviceType" NOT NULL,
  "platform" TEXT NOT NULL,
  "device_name" TEXT NOT NULL,
  "manufacturer" TEXT,
  "model" TEXT,
  "os_version" TEXT,
  "app_version" TEXT,
  "capabilities" JSONB,
  "timezone" TEXT,
  "language" TEXT,
  "home_id" TEXT,
  "room_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "devices_user_id_device_type_idx" ON "devices"("user_id","device_type");
CREATE INDEX "devices_home_id_room_id_idx" ON "devices"("home_id","room_id");
CREATE INDEX "devices_last_seen_at_idx" ON "devices"("last_seen_at");
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "device_sessions" (
  "id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "profile_id" UUID,
  "status" "DeviceSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "session_key" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "device_sessions_session_key_key" ON "device_sessions"("session_key");
CREATE INDEX "device_sessions_user_id_status_idx" ON "device_sessions"("user_id","status");
CREATE INDEX "device_sessions_device_id_status_idx" ON "device_sessions"("device_id","status");
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "max_events" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "device_id" UUID,
  "home_id" TEXT,
  "room_id" TEXT,
  "event_type" "MaxEventType" NOT NULL,
  "priority" "EventPriority" NOT NULL DEFAULT 'NORMAL',
  "payload" JSONB NOT NULL,
  "target_type" TEXT,
  "target_id" TEXT,
  "delivered_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "max_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "max_events_user_id_created_at_idx" ON "max_events"("user_id","created_at");
CREATE INDEX "max_events_device_id_created_at_idx" ON "max_events"("device_id","created_at");
CREATE INDEX "max_events_home_id_created_at_idx" ON "max_events"("home_id","created_at");
CREATE INDEX "max_events_event_type_created_at_idx" ON "max_events"("event_type","created_at");
ALTER TABLE "max_events" ADD CONSTRAINT "max_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_events" ADD CONSTRAINT "max_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "profiles" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "profile_type" TEXT NOT NULL,
  "avatar_url" TEXT,
  "permissions" JSONB,
  "settings" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "profiles_user_id_idx" ON "profiles"("user_id");
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "media_states" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "content_id" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "title" TEXT,
  "position_ms" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER,
  "source_device_id" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "media_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "media_states_user_id_content_id_key" ON "media_states"("user_id","content_id");
CREATE INDEX "media_states_user_id_updated_at_idx" ON "media_states"("user_id","updated_at");
ALTER TABLE "media_states" ADD CONSTRAINT "media_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_states" ADD CONSTRAINT "media_states_source_device_id_fkey" FOREIGN KEY ("source_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;