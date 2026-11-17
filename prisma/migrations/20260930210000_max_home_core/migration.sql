-- MAX Home core domain migration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend' AND t.typname = 'HomeMemberRole' AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."HomeMemberRole" AS ENUM (''OWNER'',''ADMIN'',''MEMBER'',''CHILD'',''GUEST'',''SUPPORT'')';
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend' AND t.typname = 'HomeModeType' AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."HomeModeType" AS ENUM (''STUDY'',''WORSHIP'',''VISITOR'',''DINNER'',''FAMILY_TIME'',''SLEEP'',''MOVIE'',''TRAVEL'',''CLEANING'',''EMERGENCY'',''CUSTOM'')';
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend' AND t.typname = 'AutomationStatus' AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."AutomationStatus" AS ENUM (''ENABLED'',''PAUSED'',''DISABLED'',''FAILED'')';
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend' AND t.typname = 'IncidentStatus' AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."IncidentStatus" AS ENUM (''OPEN'',''ACKNOWLEDGED'',''RESOLVED'',''CANCELLED'')';
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'max_backend' AND t.typname = 'NotificationStatus' AND t.typtype = 'e'
  ) THEN
    EXECUTE 'CREATE TYPE "max_backend"."NotificationStatus" AS ENUM (''PENDING'',''SENT'',''DELIVERED'',''FAILED'',''READ'',''ACKNOWLEDGED'')';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "max_backend"."homes" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(),"owner_id" UUID NOT NULL,"name" TEXT NOT NULL,"timezone" TEXT,"latitude" DOUBLE PRECISION,"longitude" DOUBLE PRECISION,"settings" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "homes_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "max_backend"."home_members" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID NOT NULL,"role" "max_backend"."HomeMemberRole" NOT NULL,"permissions" JSONB,"privacy" JSONB,"joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "home_members_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "max_backend"."home_rooms" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"name" TEXT NOT NULL,"settings" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "home_rooms_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_modes" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"type" "max_backend"."HomeModeType" NOT NULL,"name" TEXT NOT NULL,"enabled" BOOLEAN NOT NULL DEFAULT false,"config" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "home_modes_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_automations" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"name" TEXT NOT NULL,"status" "max_backend"."AutomationStatus" NOT NULL DEFAULT 'ENABLED',"triggers" JSONB NOT NULL,"conditions" JSONB,"actions" JSONB NOT NULL,"schedule" JSONB,"last_run_at" TIMESTAMP(3),"last_result" JSONB,"failure_count" INTEGER NOT NULL DEFAULT 0,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "home_automations_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_scenes" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"name" TEXT NOT NULL,"actions" JSONB NOT NULL,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "home_scenes_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_notifications" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID,"event_id" UUID,"message" TEXT NOT NULL,"priority" "max_backend"."EventPriority" NOT NULL DEFAULT 'NORMAL',"status" "max_backend"."NotificationStatus" NOT NULL DEFAULT 'PENDING',"channel" TEXT NOT NULL,"target_type" TEXT,"target_id" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"delivered_at" TIMESTAMP(3),"read_at" TIMESTAMP(3),"acknowledged_at" TIMESTAMP(3),CONSTRAINT "home_notifications_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_access_grants" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID,"role" TEXT NOT NULL,"reason" TEXT,"permissions" JSONB NOT NULL,"roomIds" JSONB,"deviceIds" JSONB,"starts_at" TIMESTAMP(3) NOT NULL,"expires_at" TIMESTAMP(3) NOT NULL,"revoked_at" TIMESTAMP(3),CONSTRAINT "home_access_grants_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_incidents" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID,"type" TEXT NOT NULL,"status" "max_backend"."IncidentStatus" NOT NULL DEFAULT 'OPEN',"priority" "max_backend"."EventPriority" NOT NULL DEFAULT 'CRITICAL',"message" TEXT NOT NULL,"metadata" JSONB,"acknowledged_at" TIMESTAMP(3),"resolved_at" TIMESTAMP(3),"cancelled_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_incidents_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_locations" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID NOT NULL,"latitude" DOUBLE PRECISION NOT NULL,"longitude" DOUBLE PRECISION NOT NULL,"accuracy" DOUBLE PRECISION,"battery" INTEGER,"source" TEXT,"recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_locations_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_geofences" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"name" TEXT NOT NULL,"latitude" DOUBLE PRECISION NOT NULL,"longitude" DOUBLE PRECISION NOT NULL,"radius_m" INTEGER NOT NULL,"enabled" BOOLEAN NOT NULL DEFAULT true,"actions" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_geofences_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_integrations" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"provider" TEXT NOT NULL,"status" TEXT NOT NULL,"external_id" TEXT,"capabilities" JSONB,"metadata" JSONB,"connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"last_checked_at" TIMESTAMP(3),CONSTRAINT "home_integrations_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_health_issues" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"severity" "max_backend"."EventPriority" NOT NULL,"code" TEXT NOT NULL,"title" TEXT NOT NULL,"description" TEXT NOT NULL,"resource_type" TEXT,"resource_id" TEXT,"recommended" JSONB,"resolved_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_health_issues_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_energy_readings" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"device_id" UUID,"watts" DOUBLE PRECISION,"kwh" DOUBLE PRECISION,"voltage" DOUBLE PRECISION,"recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_energy_readings_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_tasks" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"title" TEXT NOT NULL,"assigned_to" UUID,"status" TEXT NOT NULL DEFAULT 'pending',"due_at" TIMESTAMP(3),"completed_at" TIMESTAMP(3),"metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_tasks_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_calendar_events" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"title" TEXT NOT NULL,"description" TEXT,"starts_at" TIMESTAMP(3) NOT NULL,"ends_at" TIMESTAMP(3),"created_by" UUID,"metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_calendar_events_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_payments" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID,"transaction_id" TEXT NOT NULL,"amount" DECIMAL(18,2) NOT NULL,"currency" TEXT NOT NULL,"provider" TEXT NOT NULL,"status" TEXT NOT NULL,"purpose" TEXT,"provider_ref" TEXT,"metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_payments_pkey" PRIMARY KEY ("id"));
CREATE TABLE IF NOT EXISTS "max_backend"."home_subscriptions" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"plan" TEXT NOT NULL,"status" TEXT NOT NULL,"provider" TEXT,"provider_ref" TEXT,"starts_at" TIMESTAMP(3) NOT NULL,"ends_at" TIMESTAMP(3),"metadata" JSONB,CONSTRAINT "home_subscriptions_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX IF NOT EXISTS "home_members_home_id_user_id_key" ON "max_backend"."home_members"("home_id","user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "home_rooms_home_id_name_key" ON "max_backend"."home_rooms"("home_id","name");
CREATE UNIQUE INDEX IF NOT EXISTS "home_modes_home_id_type_name_key" ON "max_backend"."home_modes"("home_id","type","name");
CREATE UNIQUE INDEX IF NOT EXISTS "home_scenes_home_id_name_key" ON "max_backend"."home_scenes"("home_id","name");
CREATE UNIQUE INDEX IF NOT EXISTS "home_payments_transaction_id_key" ON "max_backend"."home_payments"("transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "home_integrations_home_id_provider_external_id_key" ON "max_backend"."home_integrations"("home_id","provider","external_id");
CREATE INDEX IF NOT EXISTS "homes_owner_id_idx" ON "max_backend"."homes"("owner_id");
CREATE INDEX IF NOT EXISTS "home_members_user_id_idx" ON "max_backend"."home_members"("user_id");
CREATE INDEX IF NOT EXISTS "home_automations_home_id_status_idx" ON "max_backend"."home_automations"("home_id","status");
CREATE INDEX IF NOT EXISTS "home_notifications_home_id_created_at_idx" ON "max_backend"."home_notifications"("home_id","created_at");
CREATE INDEX IF NOT EXISTS "home_notifications_user_id_status_idx" ON "max_backend"."home_notifications"("user_id","status");
CREATE INDEX IF NOT EXISTS "home_incidents_home_id_status_created_at_idx" ON "max_backend"."home_incidents"("home_id","status","created_at");
CREATE INDEX IF NOT EXISTS "home_locations_home_id_user_id_recorded_at_idx" ON "max_backend"."home_locations"("home_id","user_id","recorded_at");
CREATE INDEX IF NOT EXISTS "home_geofences_home_id_enabled_idx" ON "max_backend"."home_geofences"("home_id","enabled");
CREATE INDEX IF NOT EXISTS "home_integrations_home_id_status_idx" ON "max_backend"."home_integrations"("home_id","status");
CREATE INDEX IF NOT EXISTS "home_health_issues_home_id_severity_resolved_at_idx" ON "max_backend"."home_health_issues"("home_id","severity","resolved_at");
CREATE INDEX IF NOT EXISTS "home_energy_readings_home_id_recorded_at_idx" ON "max_backend"."home_energy_readings"("home_id","recorded_at");
CREATE INDEX IF NOT EXISTS "home_energy_readings_device_id_recorded_at_idx" ON "max_backend"."home_energy_readings"("device_id","recorded_at");
CREATE INDEX IF NOT EXISTS "home_tasks_home_id_status_due_at_idx" ON "max_backend"."home_tasks"("home_id","status","due_at");
CREATE INDEX IF NOT EXISTS "home_calendar_events_home_id_starts_at_idx" ON "max_backend"."home_calendar_events"("home_id","starts_at");
CREATE INDEX IF NOT EXISTS "home_payments_home_id_status_created_at_idx" ON "max_backend"."home_payments"("home_id","status","created_at");
CREATE INDEX IF NOT EXISTS "home_subscriptions_home_id_status_idx" ON "max_backend"."home_subscriptions"("home_id","status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'homes_owner_id_fkey' AND conrelid = '"max_backend"."homes"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."homes" ADD CONSTRAINT "homes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_members_home_id_fkey' AND conrelid = '"max_backend"."home_members"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_members" ADD CONSTRAINT "home_members_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_members_user_id_fkey' AND conrelid = '"max_backend"."home_members"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_members" ADD CONSTRAINT "home_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "max_backend"."ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_rooms_home_id_fkey' AND conrelid = '"max_backend"."home_rooms"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_rooms" ADD CONSTRAINT "home_rooms_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_modes_home_id_fkey' AND conrelid = '"max_backend"."home_modes"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_modes" ADD CONSTRAINT "home_modes_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_automations_home_id_fkey' AND conrelid = '"max_backend"."home_automations"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_automations" ADD CONSTRAINT "home_automations_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_scenes_home_id_fkey' AND conrelid = '"max_backend"."home_scenes"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_scenes" ADD CONSTRAINT "home_scenes_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_notifications_home_id_fkey' AND conrelid = '"max_backend"."home_notifications"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_notifications" ADD CONSTRAINT "home_notifications_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_access_grants_home_id_fkey' AND conrelid = '"max_backend"."home_access_grants"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_access_grants" ADD CONSTRAINT "home_access_grants_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_incidents_home_id_fkey' AND conrelid = '"max_backend"."home_incidents"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_incidents" ADD CONSTRAINT "home_incidents_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_locations_home_id_fkey' AND conrelid = '"max_backend"."home_locations"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_locations" ADD CONSTRAINT "home_locations_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_geofences_home_id_fkey' AND conrelid = '"max_backend"."home_geofences"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_geofences" ADD CONSTRAINT "home_geofences_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_integrations_home_id_fkey' AND conrelid = '"max_backend"."home_integrations"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_integrations" ADD CONSTRAINT "home_integrations_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_health_issues_home_id_fkey' AND conrelid = '"max_backend"."home_health_issues"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_health_issues" ADD CONSTRAINT "home_health_issues_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_energy_readings_home_id_fkey' AND conrelid = '"max_backend"."home_energy_readings"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_energy_readings" ADD CONSTRAINT "home_energy_readings_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_tasks_home_id_fkey' AND conrelid = '"max_backend"."home_tasks"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_tasks" ADD CONSTRAINT "home_tasks_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_calendar_events_home_id_fkey' AND conrelid = '"max_backend"."home_calendar_events"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_calendar_events" ADD CONSTRAINT "home_calendar_events_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_payments_home_id_fkey' AND conrelid = '"max_backend"."home_payments"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_payments" ADD CONSTRAINT "home_payments_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_subscriptions_home_id_fkey' AND conrelid = '"max_backend"."home_subscriptions"'::regclass
  ) THEN
    ALTER TABLE "max_backend"."home_subscriptions" ADD CONSTRAINT "home_subscriptions_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "max_backend"."homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;
