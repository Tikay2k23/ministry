CREATE TABLE "gathering_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gathering_id" uuid NOT NULL,
	"serving_role_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"substitute_for_id" uuid,
	"responded_at" timestamp with time zone,
	"response_note" text,
	"notified_at" timestamp with time zone,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gathering_assignments_status_check" CHECK (status IN ('pending', 'confirmed', 'declined', 'replaced', 'cancelled')),
	CONSTRAINT "gathering_assignments_source_check" CHECK (source IN ('rotation', 'manual', 'substitute')),
	CONSTRAINT "gathering_assignments_not_self_substitute" CHECK (substitute_for_id IS NULL OR substitute_for_id <> id),
	CONSTRAINT "gathering_assignments_substitute_source" CHECK ((source = 'substitute') = (substitute_for_id IS NOT NULL)),
	CONSTRAINT "gathering_assignments_note_length" CHECK (response_note IS NULL OR length(response_note) <= 500)
);
--> statement-breakpoint
CREATE TABLE "gathering_schedule_teams" (
	"schedule_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "gathering_schedule_teams_pk" PRIMARY KEY("schedule_id","position"),
	CONSTRAINT "gathering_schedule_teams_position" CHECK (position BETWEEN 0 AND 51)
);
--> statement-breakpoint
CREATE TABLE "gathering_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gathering_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rrule" text NOT NULL,
	"start_time" time NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"rotation_mode" text DEFAULT 'none' NOT NULL,
	"rotation_anchor" date,
	"generate_days_ahead" smallint DEFAULT 56 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gathering_schedules_rotation_mode_check" CHECK (rotation_mode IN ('none', 'per_occurrence', 'weekly')),
	CONSTRAINT "gathering_schedules_rotation_anchor" CHECK (rotation_mode = 'none' OR rotation_anchor IS NOT NULL),
	CONSTRAINT "gathering_schedules_name_length" CHECK (length(btrim(name)) BETWEEN 1 AND 80),
	CONSTRAINT "gathering_schedules_duration" CHECK (duration_minutes BETWEEN 5 AND 600),
	CONSTRAINT "gathering_schedules_days_ahead" CHECK (generate_days_ahead BETWEEN 1 AND 180),
	CONSTRAINT "gathering_schedules_dates" CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
--> statement-breakpoint
CREATE TABLE "gathering_type_roles" (
	"gathering_type_id" uuid NOT NULL,
	"serving_role_id" uuid NOT NULL,
	"min_count" smallint DEFAULT 1 NOT NULL,
	"max_count" smallint DEFAULT 1 NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "gathering_type_roles_pk" PRIMARY KEY("gathering_type_id","serving_role_id"),
	CONSTRAINT "gathering_type_roles_min" CHECK (min_count BETWEEN 0 AND 20),
	CONSTRAINT "gathering_type_roles_max" CHECK (max_count >= greatest(min_count, 1) AND max_count <= 20)
);
--> statement-breakpoint
CREATE TABLE "gathering_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"default_start_time" time NOT NULL,
	"default_duration_minutes" smallint NOT NULL,
	"ministry_id" uuid,
	"response_lock_hours" smallint DEFAULT 12 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gathering_types_key_unique" UNIQUE("key"),
	CONSTRAINT "gathering_types_key_format" CHECK (key ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "gathering_types_name_length" CHECK (length(btrim(name)) BETWEEN 1 AND 80),
	CONSTRAINT "gathering_types_duration" CHECK (default_duration_minutes BETWEEN 5 AND 600),
	CONSTRAINT "gathering_types_lock_hours" CHECK (response_lock_hours BETWEEN 0 AND 168)
);
--> statement-breakpoint
CREATE TABLE "gatherings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gathering_type_id" uuid NOT NULL,
	"schedule_id" uuid,
	"occurs_on" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"team_id" uuid,
	"title" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"roster_published_at" timestamp with time zone,
	"cancel_reason" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gatherings_status_check" CHECK (status IN ('scheduled', 'cancelled', 'completed')),
	CONSTRAINT "gatherings_times" CHECK (ends_at > starts_at),
	CONSTRAINT "gatherings_cancel_reason" CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL)),
	CONSTRAINT "gatherings_title_length" CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "serving_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serving_roles_key_unique" UNIQUE("key"),
	CONSTRAINT "serving_roles_category_check" CHECK (category IN ('music', 'word', 'prayer', 'production', 'hosting', 'other')),
	CONSTRAINT "serving_roles_key_format" CHECK (key ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "serving_roles_name_length" CHECK (length(btrim(name)) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "team_member_serving_roles" (
	"team_membership_id" uuid NOT NULL,
	"serving_role_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "team_member_serving_roles_pk" PRIMARY KEY("team_membership_id","serving_role_id")
);
--> statement-breakpoint
CREATE TABLE "person_unavailability" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unavailability_times" CHECK (ends_at > starts_at),
	CONSTRAINT "unavailability_source_check" CHECK (source IN ('self', 'coordinator', 'admin')),
	CONSTRAINT "unavailability_reason_length" CHECK (reason IS NULL OR length(reason) <= 200)
);
--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_default_scope_type_check";--> statement-breakpoint
ALTER TABLE "user_role_assignments" DROP CONSTRAINT "role_assignment_scope_type_check";--> statement-breakpoint
ALTER TABLE "user_role_assignments" DROP CONSTRAINT "role_assignment_scope_arity";--> statement-breakpoint
ALTER TABLE "action_tokens" DROP CONSTRAINT "action_tokens_purpose_check";--> statement-breakpoint
DROP INDEX "role_assignment_active";--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD COLUMN "scope_gathering_type_id" uuid;--> statement-breakpoint
ALTER TABLE "gathering_assignments" ADD CONSTRAINT "gathering_assignments_gathering_id_gatherings_id_fk" FOREIGN KEY ("gathering_id") REFERENCES "public"."gatherings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_assignments" ADD CONSTRAINT "gathering_assignments_serving_role_id_serving_roles_id_fk" FOREIGN KEY ("serving_role_id") REFERENCES "public"."serving_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_assignments" ADD CONSTRAINT "gathering_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_assignments" ADD CONSTRAINT "gathering_assignments_substitute_for_id_gathering_assignments_id_fk" FOREIGN KEY ("substitute_for_id") REFERENCES "public"."gathering_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_assignments" ADD CONSTRAINT "gathering_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_schedule_teams" ADD CONSTRAINT "gathering_schedule_teams_schedule_id_gathering_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."gathering_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_schedule_teams" ADD CONSTRAINT "gathering_schedule_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_schedules" ADD CONSTRAINT "gathering_schedules_gathering_type_id_gathering_types_id_fk" FOREIGN KEY ("gathering_type_id") REFERENCES "public"."gathering_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_schedules" ADD CONSTRAINT "gathering_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_type_roles" ADD CONSTRAINT "gathering_type_roles_gathering_type_id_gathering_types_id_fk" FOREIGN KEY ("gathering_type_id") REFERENCES "public"."gathering_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_type_roles" ADD CONSTRAINT "gathering_type_roles_serving_role_id_serving_roles_id_fk" FOREIGN KEY ("serving_role_id") REFERENCES "public"."serving_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathering_types" ADD CONSTRAINT "gathering_types_ministry_id_ministries_id_fk" FOREIGN KEY ("ministry_id") REFERENCES "public"."ministries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gatherings" ADD CONSTRAINT "gatherings_gathering_type_id_gathering_types_id_fk" FOREIGN KEY ("gathering_type_id") REFERENCES "public"."gathering_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gatherings" ADD CONSTRAINT "gatherings_schedule_id_gathering_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."gathering_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gatherings" ADD CONSTRAINT "gatherings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gatherings" ADD CONSTRAINT "gatherings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_serving_roles" ADD CONSTRAINT "team_member_serving_roles_team_membership_id_team_memberships_id_fk" FOREIGN KEY ("team_membership_id") REFERENCES "public"."team_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_serving_roles" ADD CONSTRAINT "team_member_serving_roles_serving_role_id_serving_roles_id_fk" FOREIGN KEY ("serving_role_id") REFERENCES "public"."serving_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_unavailability" ADD CONSTRAINT "person_unavailability_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gathering_assignment_active" ON "gathering_assignments" USING btree ("gathering_id","serving_role_id","person_id") WHERE status IN ('pending', 'confirmed');--> statement-breakpoint
CREATE INDEX "gathering_assignments_gathering" ON "gathering_assignments" USING btree ("gathering_id");--> statement-breakpoint
CREATE INDEX "gathering_assignments_person" ON "gathering_assignments" USING btree ("person_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "gathering_assignments_pending" ON "gathering_assignments" USING btree ("gathering_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "gathering_schedule_teams_team" ON "gathering_schedule_teams" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "gathering_schedules_type" ON "gathering_schedules" USING btree ("gathering_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gatherings_generated" ON "gatherings" USING btree ("schedule_id","occurs_on") WHERE schedule_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gatherings_by_date" ON "gatherings" USING btree ("occurs_on","gathering_type_id");--> statement-breakpoint
CREATE INDEX "gatherings_by_start" ON "gatherings" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_primary_role" ON "team_member_serving_roles" USING btree ("team_membership_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "team_member_serving_roles_role" ON "team_member_serving_roles" USING btree ("serving_role_id");--> statement-breakpoint
CREATE INDEX "unavailability_lookup" ON "person_unavailability" USING gist ("person_id",tstzrange(starts_at, ends_at));--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_scope_gathering_type_id_gathering_types_id_fk" FOREIGN KEY ("scope_gathering_type_id") REFERENCES "public"."gathering_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_active" ON "user_role_assignments" USING btree ("user_id","role_id","scope_type",coalesce(scope_person_id, scope_ministry_id, scope_team_id, scope_prayer_chain_id, scope_gathering_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE revoked_at IS NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_default_scope_type_check" CHECK (default_scope_type IN ('global', 'branch', 'ministry', 'team', 'prayer_chain', 'gathering_type'));--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "role_assignment_gathering_type_scope" CHECK (scope_type <> 'gathering_type' OR scope_gathering_type_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "role_assignment_scope_type_check" CHECK (scope_type IN ('global', 'branch', 'ministry', 'team', 'prayer_chain', 'gathering_type'));--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "role_assignment_scope_arity" CHECK (num_nonnulls(scope_person_id, scope_ministry_id, scope_team_id, scope_prayer_chain_id, scope_gathering_type_id) = CASE WHEN scope_type = 'global' THEN 0 ELSE 1 END);--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_purpose_check" CHECK (purpose IN ('personal_key_install', 'prayer_assignment', 'gathering_assignment'));--> statement-breakpoint
-- Row-level security for the new tables, as for every table (see drizzle/0007_row_level_security.sql).
ALTER TABLE "serving_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "serving_roles" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "gathering_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "gathering_types" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "gathering_type_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "gathering_type_roles" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "gathering_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "gathering_schedules" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "gathering_schedule_teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "gathering_schedule_teams" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "gatherings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "gatherings" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "gathering_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "gathering_assignments" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "team_member_serving_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "team_member_serving_roles" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "person_unavailability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "person_unavailability" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);