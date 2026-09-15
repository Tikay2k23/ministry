CREATE TABLE "leadership_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"depth" smallint NOT NULL,
	"name" text NOT NULL,
	"plural_name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leadership_levels_depth_unique" UNIQUE("depth"),
	CONSTRAINT "leadership_levels_depth_check" CHECK (depth >= 0)
);
--> statement-breakpoint
CREATE TABLE "privacy_notice_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"body_markdown" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by" uuid
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "designation_types" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_code" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"suffix" text,
	"preferred_name" text,
	"gender" text,
	"birth_month" smallint,
	"birth_day" smallint,
	"birth_year" smallint,
	"phone_e164" text,
	"phone_verified_at" timestamp with time zone,
	"email" "citext",
	"address_line" text,
	"city" text,
	"province" text,
	"country_code" char(2),
	"status" text DEFAULT 'active' NOT NULL,
	"registration_status" text DEFAULT 'confirmed' NOT NULL,
	"source" text NOT NULL,
	"joined_on" date,
	"journal_expected" boolean DEFAULT true NOT NULL,
	"consent_version" text,
	"consent_at" timestamp with time zone,
	"guardian_name" text,
	"guardian_relationship" text,
	"guardian_consent_at" timestamp with time zone,
	"merged_into_person_id" uuid,
	"archived_at" timestamp with time zone,
	"archived_reason" text,
	"search_name" text GENERATED ALWAYS AS (lower(immutable_unaccent(first_name || ' ' || coalesce(preferred_name, '') || ' ' || coalesce(middle_name, '') || ' ' || last_name))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "people_person_code_unique" UNIQUE("person_code"),
	CONSTRAINT "people_person_code_format" CHECK (person_code ~ '^P-[0-9A-HJKMNP-TV-Z]{6}$'),
	CONSTRAINT "people_first_name_length" CHECK (length(btrim(first_name)) BETWEEN 1 AND 80),
	CONSTRAINT "people_last_name_length" CHECK (length(btrim(last_name)) BETWEEN 1 AND 80),
	CONSTRAINT "people_gender_check" CHECK (gender IS NULL OR gender IN ('male', 'female')),
	CONSTRAINT "people_birth_month_check" CHECK (birth_month IS NULL OR birth_month BETWEEN 1 AND 12),
	CONSTRAINT "people_birth_day_check" CHECK (birth_day IS NULL OR birth_day BETWEEN 1 AND 31),
	CONSTRAINT "people_birth_year_check" CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
	CONSTRAINT "people_phone_format" CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "people_status_check" CHECK (status IN ('active', 'inactive')),
	CONSTRAINT "people_registration_status_check" CHECK (registration_status IN ('unconfirmed', 'confirmed', 'rejected')),
	CONSTRAINT "people_source_check" CHECK (source IN ('portal', 'import', 'public_registration')),
	CONSTRAINT "people_archived_reason_check" CHECK (archived_reason IS NULL OR archived_reason IN ('left', 'moved', 'deceased', 'duplicate', 'anonymised', 'other')),
	CONSTRAINT "people_archive_consistency" CHECK ((archived_at IS NULL) = (archived_reason IS NULL)),
	CONSTRAINT "people_merge_consistency" CHECK (merged_into_person_id IS NULL OR (archived_reason = 'duplicate' AND merged_into_person_id <> id))
);
--> statement-breakpoint
CREATE TABLE "person_designations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"designation_key" text NOT NULL,
	"started_on" date DEFAULT current_date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_designations_dates" CHECK (ended_on IS NULL OR ended_on >= started_on)
);
--> statement-breakpoint
CREATE TABLE "person_duplicate_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"reasons" text[] NOT NULL,
	"score" numeric(4, 3) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_pair_unique" UNIQUE("person_a_id","person_b_id"),
	CONSTRAINT "duplicate_pair_order" CHECK (person_a_id < person_b_id),
	CONSTRAINT "duplicate_score_range" CHECK (score BETWEEN 0 AND 1),
	CONSTRAINT "duplicate_status_check" CHECK (status IN ('open', 'merged', 'not_duplicate'))
);
--> statement-breakpoint
CREATE TABLE "hierarchy_closure" (
	"ancestor_id" uuid NOT NULL,
	"descendant_id" uuid NOT NULL,
	"depth" smallint NOT NULL,
	CONSTRAINT "hierarchy_closure_pk" PRIMARY KEY("ancestor_id","descendant_id"),
	CONSTRAINT "hierarchy_closure_depth_check" CHECK (depth >= 0),
	CONSTRAINT "hierarchy_closure_self_depth" CHECK ((depth = 0) = (ancestor_id = descendant_id))
);
--> statement-breakpoint
CREATE TABLE "hierarchy_nodes" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"parent_person_id" uuid,
	"depth" smallint NOT NULL,
	"primary_leader_person_id" uuid,
	"accepts_members" boolean DEFAULT false NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hierarchy_nodes_depth_check" CHECK (depth >= 0),
	CONSTRAINT "hierarchy_nodes_not_self_parent" CHECK (parent_person_id IS NULL OR parent_person_id <> person_id),
	CONSTRAINT "hierarchy_nodes_root_depth" CHECK ((parent_person_id IS NULL) = (depth = 0))
);
--> statement-breakpoint
CREATE TABLE "leader_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"from_leader_person_id" uuid,
	"to_leader_person_id" uuid NOT NULL,
	"source" text NOT NULL,
	"requested_by_user_id" uuid,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leader_change_source_check" CHECK (source IN ('public_form', 'portal', 'registration_correction')),
	CONSTRAINT "leader_change_status_check" CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'superseded')),
	CONSTRAINT "leader_change_not_self" CHECK (to_leader_person_id <> person_id),
	CONSTRAINT "leader_change_decision_consistency" CHECK ((status = 'pending') = (decided_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE "leadership_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"previous_leader_person_id" uuid,
	"new_leader_person_id" uuid,
	"change_type" text NOT NULL,
	"moved_with_subtree" boolean DEFAULT false NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"request_id" uuid,
	"operation_id" uuid NOT NULL,
	"changed_by" uuid,
	CONSTRAINT "leadership_history_change_type_check" CHECK (change_type IN ('placed', 'moved', 'removed', 'group_reassigned'))
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ministry_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_id_ministry_unique" UNIQUE("id","ministry_id")
);
--> statement-breakpoint
CREATE TABLE "ministries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ministries_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ministry_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"ministry_id" uuid NOT NULL,
	"department_id" uuid,
	"position" text DEFAULT 'member' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"started_on" date DEFAULT current_date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ministry_memberships_position_check" CHECK (position IN ('member', 'worker', 'assistant_head', 'head')),
	CONSTRAINT "ministry_memberships_dates" CHECK (ended_on IS NULL OR ended_on >= started_on)
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"member_role" text DEFAULT 'member' NOT NULL,
	"joined_on" date DEFAULT current_date NOT NULL,
	"left_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_role_check" CHECK (member_role IN ('lead', 'assistant', 'member')),
	CONSTRAINT "team_memberships_dates" CHECK (left_on IS NULL OR left_on >= joined_on)
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ministry_id" uuid NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"team_type" text DEFAULT 'general' NOT NULL,
	"lead_person_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_team_type_check" CHECK (team_type IN ('general', 'worship', 'prayer', 'production', 'hospitality'))
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_provider_account" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"two_factor_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"description" text NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"is_pastoral" boolean DEFAULT false NOT NULL,
	"allowed_scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"branch_depth_cap" smallint,
	CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id","permission_key"),
	CONSTRAINT "role_permissions_depth_cap_check" CHECK (branch_depth_cap IS NULL OR branch_depth_cap > 0)
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"default_scope_type" text NOT NULL,
	"default_branch_depth" smallint,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key"),
	CONSTRAINT "roles_default_scope_type_check" CHECK (default_scope_type IN ('global', 'branch', 'ministry', 'team')),
	CONSTRAINT "roles_default_branch_depth_check" CHECK (default_branch_depth IS NULL OR default_branch_depth > 0)
);
--> statement-breakpoint
CREATE TABLE "user_role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_person_id" uuid,
	"scope_ministry_id" uuid,
	"scope_team_id" uuid,
	"branch_max_depth" smallint,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"grant_reason" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "role_assignment_scope_type_check" CHECK (scope_type IN ('global', 'branch', 'ministry', 'team')),
	CONSTRAINT "role_assignment_scope_arity" CHECK (num_nonnulls(scope_person_id, scope_ministry_id, scope_team_id) = CASE WHEN scope_type = 'global' THEN 0 ELSE 1 END),
	CONSTRAINT "role_assignment_branch_scope" CHECK (scope_type <> 'branch' OR scope_person_id IS NOT NULL),
	CONSTRAINT "role_assignment_ministry_scope" CHECK (scope_type <> 'ministry' OR scope_ministry_id IS NOT NULL),
	CONSTRAINT "role_assignment_team_scope" CHECK (scope_type <> 'team' OR scope_team_id IS NOT NULL),
	CONSTRAINT "role_assignment_branch_depth" CHECK (branch_max_depth IS NULL OR (branch_max_depth > 0 AND scope_type = 'branch'))
);
--> statement-breakpoint
CREATE TABLE "user_two_factors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_encrypted" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"backup_code_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_used_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_two_factors_failed_attempts_check" CHECK (failed_attempts >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid,
	"email" "citext" NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_person_id_unique" UNIQUE("person_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_status_check" CHECK (status IN ('invited', 'active', 'suspended', 'deactivated'))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_person_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"summary" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"reason" text,
	"request_id" text,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "audit_category_check" CHECK (category IN ('change', 'access', 'auth', 'security', 'system')),
	CONSTRAINT "audit_actor_type_check" CHECK (actor_type IN ('user', 'participant', 'system'))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"file_name" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "import_jobs_kind_check" CHECK (kind IN ('people_hierarchy')),
	CONSTRAINT "import_jobs_status_check" CHECK (status IN ('uploaded', 'validating', 'previewed', 'committing', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"import_job_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"outcome" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_person_id" uuid,
	"created_person_id" uuid,
	CONSTRAINT "import_rows_pk" PRIMARY KEY("import_job_id","row_no"),
	CONSTRAINT "import_rows_outcome_check" CHECK (outcome IN ('valid', 'warning', 'error', 'duplicate_candidate', 'imported', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_consent_version_privacy_notice_versions_version_fk" FOREIGN KEY ("consent_version") REFERENCES "public"."privacy_notice_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_into_person_id_people_id_fk" FOREIGN KEY ("merged_into_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_designations" ADD CONSTRAINT "person_designations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_designations" ADD CONSTRAINT "person_designations_designation_key_designation_types_key_fk" FOREIGN KEY ("designation_key") REFERENCES "public"."designation_types"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "person_duplicate_candidates" ADD CONSTRAINT "person_duplicate_candidates_person_a_id_people_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_duplicate_candidates" ADD CONSTRAINT "person_duplicate_candidates_person_b_id_people_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_duplicate_candidates" ADD CONSTRAINT "person_duplicate_candidates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hierarchy_closure" ADD CONSTRAINT "hierarchy_closure_ancestor_id_hierarchy_nodes_person_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."hierarchy_nodes"("person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hierarchy_closure" ADD CONSTRAINT "hierarchy_closure_descendant_id_hierarchy_nodes_person_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."hierarchy_nodes"("person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hierarchy_nodes" ADD CONSTRAINT "hierarchy_nodes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hierarchy_nodes" ADD CONSTRAINT "hierarchy_nodes_parent_person_id_hierarchy_nodes_person_id_fk" FOREIGN KEY ("parent_person_id") REFERENCES "public"."hierarchy_nodes"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hierarchy_nodes" ADD CONSTRAINT "hierarchy_nodes_primary_leader_person_id_hierarchy_nodes_person_id_fk" FOREIGN KEY ("primary_leader_person_id") REFERENCES "public"."hierarchy_nodes"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leader_change_requests" ADD CONSTRAINT "leader_change_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leader_change_requests" ADD CONSTRAINT "leader_change_requests_from_leader_person_id_people_id_fk" FOREIGN KEY ("from_leader_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leader_change_requests" ADD CONSTRAINT "leader_change_requests_to_leader_person_id_people_id_fk" FOREIGN KEY ("to_leader_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leader_change_requests" ADD CONSTRAINT "leader_change_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leader_change_requests" ADD CONSTRAINT "leader_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_history" ADD CONSTRAINT "leadership_history_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_history" ADD CONSTRAINT "leadership_history_previous_leader_person_id_people_id_fk" FOREIGN KEY ("previous_leader_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_history" ADD CONSTRAINT "leadership_history_new_leader_person_id_people_id_fk" FOREIGN KEY ("new_leader_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_history" ADD CONSTRAINT "leadership_history_request_id_leader_change_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."leader_change_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_history" ADD CONSTRAINT "leadership_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_ministry_id_ministries_id_fk" FOREIGN KEY ("ministry_id") REFERENCES "public"."ministries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_memberships" ADD CONSTRAINT "ministry_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_memberships" ADD CONSTRAINT "ministry_memberships_ministry_id_ministries_id_fk" FOREIGN KEY ("ministry_id") REFERENCES "public"."ministries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_memberships" ADD CONSTRAINT "ministry_memberships_department_same_ministry_fk" FOREIGN KEY ("department_id","ministry_id") REFERENCES "public"."departments"("id","ministry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_ministry_id_ministries_id_fk" FOREIGN KEY ("ministry_id") REFERENCES "public"."ministries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_lead_person_id_people_id_fk" FOREIGN KEY ("lead_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_same_ministry_fk" FOREIGN KEY ("department_id","ministry_id") REFERENCES "public"."departments"("id","ministry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_scope_person_id_hierarchy_nodes_person_id_fk" FOREIGN KEY ("scope_person_id") REFERENCES "public"."hierarchy_nodes"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_scope_ministry_id_ministries_id_fk" FOREIGN KEY ("scope_ministry_id") REFERENCES "public"."ministries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_scope_team_id_teams_id_fk" FOREIGN KEY ("scope_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_two_factors" ADD CONSTRAINT "user_two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_matched_person_id_people_id_fk" FOREIGN KEY ("matched_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_created_person_id_people_id_fk" FOREIGN KEY ("created_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_search_trgm" ON "people" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_phone" ON "people" USING btree ("phone_e164") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "people_email" ON "people" USING btree ("email") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "people_sort_name" ON "people" USING btree ("last_name","first_name","id") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "people_unconfirmed" ON "people" USING btree ("created_at") WHERE registration_status = 'unconfirmed' AND archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "person_designation_active" ON "person_designations" USING btree ("person_id","designation_key") WHERE ended_on IS NULL;--> statement-breakpoint
CREATE INDEX "duplicate_open" ON "person_duplicate_candidates" USING btree ("created_at") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "closure_by_descendant" ON "hierarchy_closure" USING btree ("descendant_id","depth");--> statement-breakpoint
CREATE INDEX "closure_by_ancestor_depth" ON "hierarchy_closure" USING btree ("ancestor_id","depth");--> statement-breakpoint
CREATE INDEX "hierarchy_children" ON "hierarchy_nodes" USING btree ("parent_person_id");--> statement-breakpoint
CREATE INDEX "hierarchy_primary" ON "hierarchy_nodes" USING btree ("primary_leader_person_id");--> statement-breakpoint
CREATE INDEX "hierarchy_acceptors" ON "hierarchy_nodes" USING btree ("person_id") WHERE accepts_members;--> statement-breakpoint
CREATE UNIQUE INDEX "leader_change_one_pending" ON "leader_change_requests" USING btree ("person_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "leader_change_inbox" ON "leader_change_requests" USING btree ("to_leader_person_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "leadership_history_person" ON "leadership_history" USING btree ("person_id","effective_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leadership_history_leader" ON "leadership_history" USING btree ("new_leader_person_id","effective_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_active" ON "departments" USING btree ("ministry_id",lower(name)) WHERE archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ministries_name_active" ON "ministries" USING btree (lower(name)) WHERE archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ministry_membership_active" ON "ministry_memberships" USING btree ("person_id","ministry_id") WHERE ended_on IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ministry_membership_primary" ON "ministry_memberships" USING btree ("person_id") WHERE is_primary AND ended_on IS NULL;--> statement-breakpoint
CREATE INDEX "ministry_membership_by_ministry" ON "ministry_memberships" USING btree ("ministry_id","department_id") WHERE ended_on IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "team_membership_active" ON "team_memberships" USING btree ("team_id","person_id") WHERE left_on IS NULL;--> statement-breakpoint
CREATE INDEX "team_membership_person" ON "team_memberships" USING btree ("person_id") WHERE left_on IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_active" ON "teams" USING btree ("ministry_id",lower(name)) WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "auth_accounts_user" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_active" ON "user_role_assignments" USING btree ("user_id","role_id","scope_type",coalesce(scope_person_id, scope_ministry_id, scope_team_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "role_assignment_by_user" ON "user_role_assignments" USING btree ("user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "audit_by_entity" ON "audit_logs" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_by_actor" ON "audit_logs" USING btree ("actor_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_by_time" ON "audit_logs" USING brin (occurred_at);