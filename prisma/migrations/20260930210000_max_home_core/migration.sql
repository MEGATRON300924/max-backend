-- MAX Home core domain migration
CREATE TYPE "HomeMemberRole" AS ENUM ('OWNER','ADMIN','MEMBER','CHILD','GUEST','SUPPORT');
CREATE TYPE "HomeModeType" AS ENUM ('STUDY','WORSHIP','VISITOR','DINNER','FAMILY_TIME','SLEEP','MOVIE','TRAVEL','CLEANING','EMERGENCY','CUSTOM');
CREATE TYPE "AutomationStatus" AS ENUM ('ENABLED','PAUSED','DISABLED','FAILED');
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN','ACKNOWLEDGED','RESOLVED','CANCELLED');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING','SENT','DELIVERED','FAILED','READ','ACKNOWLEDGED');

CREATE TABLE "homes" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(),"owner_id" UUID NOT NULL,"name" TEXT NOT NULL,"timezone" TEXT,"latitude" DOUBLE PRECISION,"longitude" DOUBLE PRECISION,"settings" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "homes_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "home_members" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID NOT NULL,"role" "HomeMemberRole" NOT NULL,"permissions" JSONB,"privacy" JSONB,"joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "home_members_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "home_rooms" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"name" TEXT NOT NULL,"settings" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "home_rooms_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_modes" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"type" "HomeModeType" NOT NULL,"name" TEXT NOT NULL,"enabled" BOOLEAN NOT NULL DEFAULT false,"config" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "home_modes_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_automations" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"name" TEXT NOT NULL,"status" "AutomationStatus" NOT NULL DEFAULT 'ENABLED',"triggers" JSONB NOT NULL,"conditions" JSONB,"actions" JSONB NOT NULL,"schedule" JSONB,"last_run_at" TIMESTAMP(3),"last_result" JSONB,"failure_count" INTEGER NOT NULL DEFAULT 0,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "home_automations_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_scenes" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"name" TEXT NOT NULL,"actions" JSONB NOT NULL,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "home_scenes_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_notifications" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID,"event_id" UUID,"message" TEXT NOT NULL,"priority" "EventPriority" NOT NULL DEFAULT 'NORMAL',"status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',"channel" TEXT NOT NULL,"target_type" TEXT,"target_id" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"delivered_at" TIMESTAMP(3),"read_at" TIMESTAMP(3),"acknowledged_at" TIMESTAMP(3),CONSTRAINT "home_notifications_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_access_grants" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID,"role" TEXT NOT NULL,"reason" TEXT,"permissions" JSONB NOT NULL,"room_ids" JSONB,"device_ids" JSONB,"starts_at" TIMESTAMP(3) NOT NULL,"expires_at" TIMESTAMP(3) NOT NULL,"revoked_at" TIMESTAMP(3),CONSTRAINT "home_access_grants_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_incidents" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID,"type" TEXT NOT NULL,"status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',"priority" "EventPriority" NOT NULL DEFAULT 'CRITICAL',"message" TEXT NOT NULL,"metadata" JSONB,"acknowledged_at" TIMESTAMP(3),"resolved_at" TIMESTAMP(3),"cancelled_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_incidents_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_locations" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID NOT NULL,"latitude" DOUBLE PRECISION NOT NULL,"longitude" DOUBLE PRECISION NOT NULL,"accuracy" DOUBLE PRECISION,"battery" INTEGER,"source" TEXT,"recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_locations_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_geofences" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"name" TEXT NOT NULL,"latitude" DOUBLE PRECISION NOT NULL,"longitude" DOUBLE PRECISION NOT NULL,"radius_m" INTEGER NOT NULL,"enabled" BOOLEAN NOT NULL DEFAULT true,"actions" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_geofences_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_integrations" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"provider" TEXT NOT NULL,"status" TEXT NOT NULL,"external_id" TEXT,"capabilities" JSONB,"metadata" JSONB,"connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"last_checked_at" TIMESTAMP(3),CONSTRAINT "home_integrations_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_health_issues" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"severity" "EventPriority" NOT NULL,"code" TEXT NOT NULL,"title" TEXT NOT NULL,"description" TEXT NOT NULL,"resource_type" TEXT,"resource_id" TEXT,"recommended" JSONB,"resolved_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_health_issues_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_energy_readings" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"device_id" UUID,"watts" DOUBLE PRECISION,"kwh" DOUBLE PRECISION,"voltage" DOUBLE PRECISION,"recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_energy_readings_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_tasks" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"title" TEXT NOT NULL,"assigned_to" UUID,"status" TEXT NOT NULL DEFAULT 'pending',"due_at" TIMESTAMP(3),"completed_at" TIMESTAMP(3),"metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_tasks_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_calendar_events" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"title" TEXT NOT NULL,"description" TEXT,"starts_at" TIMESTAMP(3) NOT NULL,"ends_at" TIMESTAMP(3),"created_by" UUID,"metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_calendar_events_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_payments" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"user_id" UUID,"transaction_id" TEXT NOT NULL,"amount" DECIMAL(18,2) NOT NULL,"currency" TEXT NOT NULL,"provider" TEXT NOT NULL,"status" TEXT NOT NULL,"purpose" TEXT,"provider_ref" TEXT,"metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "home_payments_pkey" PRIMARY KEY ("id"));
CREATE TABLE "home_subscriptions" ("id" UUID NOT NULL DEFAULT gen_random_uuid(),"home_id" UUID NOT NULL,"plan" TEXT NOT NULL,"status" TEXT NOT NULL,"provider" TEXT,"provider_ref" TEXT,"starts_at" TIMESTAMP(3) NOT NULL,"ends_at" TIMESTAMP(3),"metadata" JSONB,CONSTRAINT "home_subscriptions_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "home_members_home_id_user_id_key" ON "home_members"("home_id","user_id");
CREATE UNIQUE INDEX "home_rooms_home_id_name_key" ON "home_rooms"("home_id","name");
CREATE UNIQUE INDEX "home_modes_home_id_type_name_key" ON "home_modes"("home_id","type","name");
CREATE UNIQUE INDEX "home_scenes_home_id_name_key" ON "home_scenes"("home_id","name");
CREATE UNIQUE INDEX "home_payments_transaction_id_key" ON "home_payments"("transaction_id");
CREATE UNIQUE INDEX "home_integrations_home_id_provider_external_id_key" ON "home_integrations"("home_id","provider","external_id");
CREATE INDEX "homes_owner_id_idx" ON "homes"("owner_id");
CREATE INDEX "home_members_user_id_idx" ON "home_members"("user_id");
CREATE INDEX "home_automations_home_id_status_idx" ON "home_automations"("home_id","status");
CREATE INDEX "home_notifications_home_id_created_at_idx" ON "home_notifications"("home_id","created_at");
CREATE INDEX "home_notifications_user_id_status_idx" ON "home_notifications"("user_id","status");
CREATE INDEX "home_incidents_home_id_status_created_at_idx" ON "home_incidents"("home_id","status","created_at");
CREATE INDEX "home_locations_home_id_user_id_recorded_at_idx" ON "home_locations"("home_id","user_id","recorded_at");
CREATE INDEX "home_geofences_home_id_enabled_idx" ON "home_geofences"("home_id","enabled");
CREATE INDEX "home_integrations_home_id_status_idx" ON "home_integrations"("home_id","status");
CREATE INDEX "home_health_issues_home_id_severity_resolved_at_idx" ON "home_health_issues"("home_id","severity","resolved_at");
CREATE INDEX "home_energy_readings_home_id_recorded_at_idx" ON "home_energy_readings"("home_id","recorded_at");
CREATE INDEX "home_energy_readings_device_id_recorded_at_idx" ON "home_energy_readings"("device_id","recorded_at");
CREATE INDEX "home_tasks_home_id_status_due_at_idx" ON "home_tasks"("home_id","status","due_at");
CREATE INDEX "home_calendar_events_home_id_starts_at_idx" ON "home_calendar_events"("home_id","starts_at");
CREATE INDEX "home_payments_home_id_status_created_at_idx" ON "home_payments"("home_id","status","created_at");
CREATE INDEX "home_subscriptions_home_id_status_idx" ON "home_subscriptions"("home_id","status");

ALTER TABLE "homes" ADD CONSTRAINT "homes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_members" ADD CONSTRAINT "home_members_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_members" ADD CONSTRAINT "home_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ecosystem_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_rooms" ADD CONSTRAINT "home_rooms_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_modes" ADD CONSTRAINT "home_modes_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_automations" ADD CONSTRAINT "home_automations_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_scenes" ADD CONSTRAINT "home_scenes_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_notifications" ADD CONSTRAINT "home_notifications_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_access_grants" ADD CONSTRAINT "home_access_grants_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_incidents" ADD CONSTRAINT "home_incidents_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_locations" ADD CONSTRAINT "home_locations_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_geofences" ADD CONSTRAINT "home_geofences_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_integrations" ADD CONSTRAINT "home_integrations_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_health_issues" ADD CONSTRAINT "home_health_issues_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_energy_readings" ADD CONSTRAINT "home_energy_readings_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_tasks" ADD CONSTRAINT "home_tasks_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_calendar_events" ADD CONSTRAINT "home_calendar_events_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_payments" ADD CONSTRAINT "home_payments_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_subscriptions" ADD CONSTRAINT "home_subscriptions_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
