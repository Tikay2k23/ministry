CREATE TABLE "prayer_assignment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"via" text,
	"note" text,
	CONSTRAINT "prayer_events_type_check" CHECK (event_type IN ('assigned', 'confirmed', 'checked_in', 'completed', 'cannot_make_it', 'substitute_assigned', 'flagged_follow_up', 'resolved_missed', 'resolved_excused', 'resolved_completed', 'cancelled', 'reopened', 'report_submitted')),
	CONSTRAINT "prayer_events_actor_check" CHECK (actor_type IN ('user', 'participant', 'system')),
	CONSTRAINT "prayer_events_via_check" CHECK (via IS NULL OR via IN ('action_link', 'chain_page', 'portal', 'job'))
);
--> statement-breakpoint
CREATE TABLE "prayer_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slot_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"completed_late" boolean DEFAULT false NOT NULL,
	"verified_by_coordinator" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"commitment_id" uuid,
	"substitute_for_id" uuid,
	"confirmed_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cannot_make_it_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"report_response_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_assignments_report_response_id_unique" UNIQUE("report_response_id"),
	CONSTRAINT "prayer_assignments_status_check" CHECK (status IN ('scheduled', 'confirmed', 'in_prayer', 'completed', 'needs_follow_up', 'missed', 'excused', 'replaced', 'cancelled')),
	CONSTRAINT "prayer_assignments_source_check" CHECK (source IN ('commitment', 'manual', 'substitute', 'self_signup')),
	CONSTRAINT "prayer_assignments_times" CHECK (ends_at > starts_at),
	CONSTRAINT "prayer_assignments_not_self_substitute" CHECK (substitute_for_id IS NULL OR substitute_for_id <> id),
	CONSTRAINT "prayer_assignments_human_resolution" CHECK (status NOT IN ('missed', 'excused') OR resolved_by IS NOT NULL),
	CONSTRAINT "prayer_assignments_commitment_source" CHECK ((source = 'commitment') = (commitment_id IS NOT NULL)),
	CONSTRAINT "prayer_assignments_substitute_source" CHECK ((source = 'substitute') = (substitute_for_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "prayer_chain_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prayer_chain_id" uuid NOT NULL,
	"rrule" text NOT NULL,
	"first_slot_time" time NOT NULL,
	"slot_minutes" smallint NOT NULL,
	"slots_per_occurrence" smallint NOT NULL,
	"capacity" smallint DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"generate_days_ahead" smallint DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_schedules_slot_minutes" CHECK (slot_minutes BETWEEN 5 AND 1440),
	CONSTRAINT "prayer_schedules_slots_per_occurrence" CHECK (slots_per_occurrence BETWEEN 1 AND 288),
	CONSTRAINT "prayer_schedules_occurrence_length" CHECK (slot_minutes * slots_per_occurrence <= 1440),
	CONSTRAINT "prayer_schedules_capacity" CHECK (capacity BETWEEN 1 AND 50),
	CONSTRAINT "prayer_schedules_days_ahead" CHECK (generate_days_ahead BETWEEN 1 AND 90),
	CONSTRAINT "prayer_schedules_dates" CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
--> statement-breakpoint
CREATE TABLE "prayer_chains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"chain_type" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Manila' NOT NULL,
	"ministry_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"grace_minutes" smallint DEFAULT 15 NOT NULL,
	"checkin_opens_minutes" smallint DEFAULT 15 NOT NULL,
	"require_checkin" boolean DEFAULT false NOT NULL,
	"show_names_publicly" boolean DEFAULT false NOT NULL,
	"report_form_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_chains_type_check" CHECK (chain_type IN ('continuous', 'scheduled_blocks', 'event')),
	CONSTRAINT "prayer_chains_status_check" CHECK (status IN ('draft', 'active', 'paused', 'ended')),
	CONSTRAINT "prayer_chains_dates" CHECK (ends_on IS NULL OR ends_on >= starts_on),
	CONSTRAINT "prayer_chains_grace_range" CHECK (grace_minutes BETWEEN 0 AND 240),
	CONSTRAINT "prayer_chains_checkin_range" CHECK (checkin_opens_minutes BETWEEN 0 AND 120),
	CONSTRAINT "prayer_chains_name_length" CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "prayer_commitments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prayer_chain_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rrule" text NOT NULL,
	"local_start_time" time NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "prayer_commitments_dates" CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
--> statement-breakpoint
CREATE TABLE "prayer_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prayer_chain_id" uuid NOT NULL,
	"schedule_id" uuid,
	"chain_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" smallint DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_slots_chain_start" UNIQUE("prayer_chain_id","starts_at"),
	CONSTRAINT "prayer_slots_status_check" CHECK (status IN ('open', 'cancelled')),
	CONSTRAINT "prayer_slots_times" CHECK (ends_at > starts_at),
	CONSTRAINT "prayer_slots_capacity" CHECK (capacity BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"destination_masked" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_channel_check" CHECK (channel IN ('in_app', 'email', 'sms', 'push')),
	CONSTRAINT "deliveries_status_check" CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'bounced'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"template_key" text NOT NULL,
	"recipient_person_id" uuid,
	"recipient_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"suppressed_reason" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "notifications_status_check" CHECK (status IN ('pending', 'processing', 'sent', 'partially_sent', 'failed', 'suppressed', 'cancelled')),
	CONSTRAINT "notifications_recipient" CHECK (recipient_person_id IS NOT NULL OR recipient_user_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"job_key" text PRIMARY KEY NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"last_summary" jsonb,
	"run_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "scheduled_jobs_status_check" CHECK (last_status IS NULL OR last_status IN ('running', 'ok', 'error'))
);
--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_default_scope_type_check";--> statement-breakpoint
ALTER TABLE "user_role_assignments" DROP CONSTRAINT "role_assignment_scope_type_check";--> statement-breakpoint
ALTER TABLE "user_role_assignments" DROP CONSTRAINT "role_assignment_scope_arity";--> statement-breakpoint
ALTER TABLE "action_tokens" DROP CONSTRAINT "action_tokens_purpose_check";--> statement-breakpoint
ALTER TABLE "entry_codes" DROP CONSTRAINT "entry_codes_kind_check";--> statement-breakpoint
DROP INDEX "role_assignment_active";--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD COLUMN "scope_prayer_chain_id" uuid;--> statement-breakpoint
ALTER TABLE "action_tokens" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_codes" ADD COLUMN "prayer_chain_id" uuid;--> statement-breakpoint
ALTER TABLE "prayer_assignment_events" ADD CONSTRAINT "prayer_assignment_events_assignment_id_prayer_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."prayer_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_assignment_events" ADD CONSTRAINT "prayer_assignment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_assignments" ADD CONSTRAINT "prayer_assignments_slot_id_prayer_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."prayer_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_assignments" ADD CONSTRAINT "prayer_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_assignments" ADD CONSTRAINT "prayer_assignments_commitment_id_prayer_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."prayer_commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_assignments" ADD CONSTRAINT "prayer_assignments_substitute_for_id_prayer_assignments_id_fk" FOREIGN KEY ("substitute_for_id") REFERENCES "public"."prayer_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_assignments" ADD CONSTRAINT "prayer_assignments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_assignments" ADD CONSTRAINT "prayer_assignments_report_response_id_form_responses_id_fk" FOREIGN KEY ("report_response_id") REFERENCES "public"."form_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_assignments" ADD CONSTRAINT "prayer_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_chain_schedules" ADD CONSTRAINT "prayer_chain_schedules_prayer_chain_id_prayer_chains_id_fk" FOREIGN KEY ("prayer_chain_id") REFERENCES "public"."prayer_chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_chains" ADD CONSTRAINT "prayer_chains_ministry_id_ministries_id_fk" FOREIGN KEY ("ministry_id") REFERENCES "public"."ministries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_chains" ADD CONSTRAINT "prayer_chains_report_form_id_forms_id_fk" FOREIGN KEY ("report_form_id") REFERENCES "public"."forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_chains" ADD CONSTRAINT "prayer_chains_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_commitments" ADD CONSTRAINT "prayer_commitments_prayer_chain_id_prayer_chains_id_fk" FOREIGN KEY ("prayer_chain_id") REFERENCES "public"."prayer_chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_commitments" ADD CONSTRAINT "prayer_commitments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_commitments" ADD CONSTRAINT "prayer_commitments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_slots" ADD CONSTRAINT "prayer_slots_prayer_chain_id_prayer_chains_id_fk" FOREIGN KEY ("prayer_chain_id") REFERENCES "public"."prayer_chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_slots" ADD CONSTRAINT "prayer_slots_schedule_id_prayer_chain_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."prayer_chain_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prayer_events_by_assignment" ON "prayer_assignment_events" USING btree ("assignment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prayer_assignment_active" ON "prayer_assignments" USING btree ("slot_id","person_id") WHERE status NOT IN ('replaced', 'cancelled');--> statement-breakpoint
CREATE INDEX "prayer_assignments_slot" ON "prayer_assignments" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "prayer_assignments_person" ON "prayer_assignments" USING btree ("person_id","starts_at");--> statement-breakpoint
CREATE INDEX "prayer_assignments_open" ON "prayer_assignments" USING btree ("ends_at") WHERE status IN ('scheduled', 'confirmed', 'in_prayer');--> statement-breakpoint
CREATE INDEX "prayer_assignments_followup" ON "prayer_assignments" USING btree ("updated_at") WHERE status = 'needs_follow_up';--> statement-breakpoint
CREATE INDEX "prayer_schedules_chain" ON "prayer_chain_schedules" USING btree ("prayer_chain_id");--> statement-breakpoint
CREATE INDEX "prayer_commitments_active" ON "prayer_commitments" USING btree ("prayer_chain_id") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX "prayer_commitments_person" ON "prayer_commitments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "prayer_slots_board" ON "prayer_slots" USING btree ("prayer_chain_id","chain_date","starts_at");--> statement-breakpoint
CREATE INDEX "prayer_slots_ending" ON "prayer_slots" USING btree ("ends_at") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "deliveries_by_notification" ON "notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notifications_inbox" ON "notifications" USING btree ("recipient_user_id","created_at" DESC NULLS LAST) WHERE recipient_user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_due" ON "notifications" USING btree ("scheduled_for") WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_scope_prayer_chain_id_prayer_chains_id_fk" FOREIGN KEY ("scope_prayer_chain_id") REFERENCES "public"."prayer_chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_codes" ADD CONSTRAINT "entry_codes_prayer_chain_id_prayer_chains_id_fk" FOREIGN KEY ("prayer_chain_id") REFERENCES "public"."prayer_chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_tokens_subject" ON "action_tokens" USING btree ("subject_id") WHERE subject_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entry_code_active_chain" ON "entry_codes" USING btree ("prayer_chain_id") WHERE status = 'active' AND kind = 'prayer_chain';--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignment_active" ON "user_role_assignments" USING btree ("user_id","role_id","scope_type",coalesce(scope_person_id, scope_ministry_id, scope_team_id, scope_prayer_chain_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE revoked_at IS NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_default_scope_type_check" CHECK (default_scope_type IN ('global', 'branch', 'ministry', 'team', 'prayer_chain'));--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "role_assignment_prayer_chain_scope" CHECK (scope_type <> 'prayer_chain' OR scope_prayer_chain_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "role_assignment_scope_type_check" CHECK (scope_type IN ('global', 'branch', 'ministry', 'team', 'prayer_chain'));--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "role_assignment_scope_arity" CHECK (num_nonnulls(scope_person_id, scope_ministry_id, scope_team_id, scope_prayer_chain_id) = CASE WHEN scope_type = 'global' THEN 0 ELSE 1 END);--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_subject" CHECK (purpose = 'personal_key_install' OR subject_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_purpose_check" CHECK (purpose IN ('personal_key_install', 'prayer_assignment'));--> statement-breakpoint
ALTER TABLE "entry_codes" ADD CONSTRAINT "entry_codes_chain_consistency" CHECK ((kind = 'prayer_chain') = (prayer_chain_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "entry_codes" ADD CONSTRAINT "entry_codes_kind_check" CHECK (kind IN ('journal_general', 'journal_leader', 'prayer_chain'));