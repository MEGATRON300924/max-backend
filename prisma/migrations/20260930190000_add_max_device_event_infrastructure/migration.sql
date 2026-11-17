DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend' AND t.typname = 'DeviceType' AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."DeviceType" AS ENUM (''MOBILE'', ''TABLET'', ''TV'', ''DESKTOP'', ''SPEAKER'', ''CAR'', ''OTHER'')';
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend' AND t.typname = 'DeviceSessionStatus' AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."DeviceSessionStatus" AS ENUM (''ACTIVE'', ''REVOKED'', ''EXPIRED'')';
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend' AND t.typname = 'MaxEventType' AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."MaxEventType" AS ENUM (''ANNOUNCEMENT'', ''BROADCAST'', ''SECURITY_ALERT'', ''COMMAND'', ''MEDIA_ACTION'', ''NOTIFICATION'', ''AUTOMATION_EVENT'', ''DEVICE_CHANGED'', ''ACCOUNT_UPDATED'', ''SUBSCRIPTION_UPDATED'')';
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend' AND t.typname = 'EventPriority' AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."EventPriority" AS ENUM (''INFO'', ''NORMAL'', ''IMPORTANT'', ''CRITICAL'')';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "max_backend"."devices" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "external_id" TEXT,
  "device_type" "max_backend"."DeviceType" NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS "devices_user_id_external_id_key" ON "max_backend"."devices"("user_id","external_id");
CREATE INDEX IF NOT EXISTS "devices_user_id_device_type_idx" ON "max_backend"."devices"("user_id","device_type");
CREATE INDEX IF NOT EXISTS "devices_home_id_room_id_idx" ON "max_backend"."devices"("home_id","room_id");
CREATE INDEX IF NOT EXISTS "devices_last_seen_at_idx" ON "max_backend"."devices"("last_seen_at");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'devices_user_id_fkey' AND conrelid = '"max_backend"."devices"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "max_backend"."device_sessions" (
  "id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "profile_id" UUID,
  "status" "max_backend"."DeviceSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "session_key" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "device_sessions_session_key_key" ON "max_backend"."device_sessions"("session_key");
CREATE INDEX IF NOT EXISTS "device_sessions_user_id_status_idx" ON "max_backend"."device_sessions"("user_id","status");
CREATE INDEX IF NOT EXISTS "device_sessions_device_id_status_idx" ON "max_backend"."device_sessions"("device_id","status");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'device_sessions_device_id_fkey' AND conrelid = '"max_backend"."device_sessions"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."device_sessions" ADD CONSTRAINT "device_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "max_backend"."devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'device_sessions_user_id_fkey' AND conrelid = '"max_backend"."device_sessions"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."device_sessions" ADD CONSTRAINT "device_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "max_backend"."max_events" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "device_id" UUID,
  "home_id" TEXT,
  "room_id" TEXT,
  "event_type" "max_backend"."MaxEventType" NOT NULL,
  "priority" "max_backend"."EventPriority" NOT NULL DEFAULT 'NORMAL',
  "payload" JSONB NOT NULL,
  "target_type" TEXT,
  "target_id" TEXT,
  "delivered_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "max_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "max_events_user_id_created_at_idx" ON "max_backend"."max_events"("user_id","created_at");
CREATE INDEX IF NOT EXISTS "max_events_device_id_created_at_idx" ON "max_backend"."max_events"("device_id","created_at");
CREATE INDEX IF NOT EXISTS "max_events_home_id_created_at_idx" ON "max_backend"."max_events"("home_id","created_at");
CREATE INDEX IF NOT EXISTS "max_events_event_type_created_at_idx" ON "max_backend"."max_events"("event_type","created_at");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'max_events_user_id_fkey' AND conrelid = '"max_backend"."max_events"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."max_events" ADD CONSTRAINT "max_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'max_events_device_id_fkey' AND conrelid = '"max_backend"."max_events"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."max_events" ADD CONSTRAINT "max_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "max_backend"."devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "max_backend"."profiles" (
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
CREATE INDEX IF NOT EXISTS "profiles_user_id_idx" ON "max_backend"."profiles"("user_id");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_user_id_fkey' AND conrelid = '"max_backend"."profiles"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "max_backend"."media_states" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "media_states_user_id_content_id_key" ON "max_backend"."media_states"("user_id","content_id");
CREATE INDEX IF NOT EXISTS "media_states_user_id_updated_at_idx" ON "max_backend"."media_states"("user_id","updated_at");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_states_user_id_fkey' AND conrelid = '"max_backend"."media_states"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."media_states" ADD CONSTRAINT "media_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_states_source_device_id_fkey' AND conrelid = '"max_backend"."media_states"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."media_states" ADD CONSTRAINT "media_states_source_device_id_fkey" FOREIGN KEY ("source_device_id") REFERENCES "max_backend"."devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END;
$$;