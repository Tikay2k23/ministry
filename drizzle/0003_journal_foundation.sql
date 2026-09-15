CREATE TABLE "ministry_calendar_days" (
	"day" date PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"excuses_journal" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ministry_calendar_days_kind_check" CHECK (kind IN ('journal_rest_day', 'holiday', 'special'))
);
--> statement-breakpoint
CREATE TABLE "form_answer_sets" (
	"response_id" uuid NOT NULL,
	"sensitivity" text NOT NULL,
	"answers" jsonb NOT NULL,
	"key_version" smallint,
	CONSTRAINT "form_answer_sets_pk" PRIMARY KEY("response_id","sensitivity"),
	CONSTRAINT "form_answer_sets_sensitivity_check" CHECK (sensitivity IN ('standard', 'restricted', 'confidential'))
);
--> statement-breakpoint
CREATE TABLE "form_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"form_version_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"field_type" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"sensitivity" text DEFAULT 'standard' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" smallint NOT NULL,
	CONSTRAINT "form_fields_version_key" UNIQUE("form_version_id","field_key"),
	CONSTRAINT "form_fields_version_order" UNIQUE("form_version_id","sort_order"),
	CONSTRAINT "form_fields_key_format" CHECK (field_key ~ '^[a-z][a-z0-9_]{1,62}$'),
	CONSTRAINT "form_fields_type_check" CHECK (field_type IN ('short_text', 'long_text', 'yes_no', 'single_choice', 'multi_choice', 'number', 'scripture_ref', 'prayer_request', 'testimony', 'reflection', 'gratitude', 'date', 'time')),
	CONSTRAINT "form_fields_sensitivity_check" CHECK (sensitivity IN ('standard', 'restricted', 'confidential')),
	CONSTRAINT "form_fields_label_length" CHECK (length(btrim(label)) BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE TABLE "form_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"form_version_id" uuid NOT NULL,
	"person_id" uuid,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"form_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_versions_form_version" UNIQUE("form_id","version_no"),
	CONSTRAINT "form_versions_status_check" CHECK (status IN ('draft', 'published', 'retired')),
	CONSTRAINT "form_versions_version_positive" CHECK (version_no > 0),
	CONSTRAINT "form_versions_published_consistency" CHECK ((status = 'draft') = (published_at IS NULL)),
	CONSTRAINT "form_versions_retired_consistency" CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forms_key_unique" UNIQUE("key"),
	CONSTRAINT "forms_purpose_check" CHECK (purpose IN ('journal', 'prayer_report', 'general')),
	CONSTRAINT "forms_key_format" CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$')
);
--> statement-breakpoint
CREATE TABLE "action_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"person_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" smallint DEFAULT 1 NOT NULL,
	"use_count" smallint DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "action_tokens_purpose_check" CHECK (purpose IN ('personal_key_install')),
	CONSTRAINT "action_tokens_use_count" CHECK (use_count <= max_uses)
);
--> statement-breakpoint
CREATE TABLE "entry_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"leader_person_id" uuid,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"retired_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"last_scanned_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "entry_codes_code_format" CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
	CONSTRAINT "entry_codes_kind_check" CHECK (kind IN ('journal_general', 'journal_leader')),
	CONSTRAINT "entry_codes_status_check" CHECK (status IN ('active', 'retired')),
	CONSTRAINT "entry_codes_leader_consistency" CHECK ((kind = 'journal_leader') = (leader_person_id IS NOT NULL)),
	CONSTRAINT "entry_codes_retired_consistency" CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "participant_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"device_hint" text,
	"created_via" text NOT NULL,
	"persistent" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "participant_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "participant_keys_created_via_check" CHECK (created_via IN ('registration', 'phone_match', 'personal_link', 'otp'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limit_buckets_pk" PRIMARY KEY("bucket_key","window_start")
);
--> statement-breakpoint
CREATE TABLE "journal_days" (
	"person_id" uuid NOT NULL,
	"journal_date" date NOT NULL,
	"is_expected" boolean NOT NULL,
	"submission_status" text NOT NULL,
	"review_status" text DEFAULT 'none' NOT NULL,
	"care_status" text DEFAULT 'none' NOT NULL,
	"entry_id" uuid,
	"excuse_reason" text,
	"leader_person_id" uuid,
	"primary_leader_person_id" uuid,
	"hierarchy_path" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_days_pk" PRIMARY KEY("person_id","journal_date"),
	CONSTRAINT "journal_days_entry_id_unique" UNIQUE("entry_id"),
	CONSTRAINT "journal_days_submission_check" CHECK (submission_status IN ('pending', 'submitted', 'late', 'missed', 'excused')),
	CONSTRAINT "journal_days_review_check" CHECK (review_status IN ('none', 'awaiting', 'reviewed')),
	CONSTRAINT "journal_days_care_check" CHECK (care_status IN ('none', 'needs_follow_up', 'resolved')),
	CONSTRAINT "journal_days_excuse_check" CHECK (excuse_reason IS NULL OR excuse_reason IN ('rest_day', 'pause', 'leader_excused', 'admin_excused')),
	CONSTRAINT "journal_days_entry_consistency" CHECK ((submission_status IN ('submitted', 'late')) = (entry_id IS NOT NULL)),
	CONSTRAINT "journal_days_excuse_consistency" CHECK ((submission_status = 'excused') = (excuse_reason IS NOT NULL)),
	CONSTRAINT "journal_days_pending_open" CHECK (submission_status <> 'pending' OR finalized_at IS NULL),
	CONSTRAINT "journal_days_missed_final" CHECK (submission_status <> 'missed' OR finalized_at IS NOT NULL),
	CONSTRAINT "journal_days_expected_consistency" CHECK (is_expected OR submission_status IN ('submitted', 'late', 'excused')),
	CONSTRAINT "journal_days_review_needs_entry" CHECK (review_status = 'none' OR entry_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"journal_date" date NOT NULL,
	"form_response_id" uuid NOT NULL,
	"first_submitted_at" timestamp with time zone NOT NULL,
	"last_submitted_at" timestamp with time zone NOT NULL,
	"revision_no" smallint DEFAULT 1 NOT NULL,
	"timing" text NOT NULL,
	"channel" text NOT NULL,
	"entry_code_id" uuid,
	"proxy_user_id" uuid,
	"content_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_form_response_id_unique" UNIQUE("form_response_id"),
	CONSTRAINT "journal_entries_person_date" UNIQUE("person_id","journal_date"),
	CONSTRAINT "journal_entries_timing_check" CHECK (timing IN ('on_time', 'late')),
	CONSTRAINT "journal_entries_channel_check" CHECK (channel IN ('registration', 'phone_match', 'personal_link', 'otp', 'proxy')),
	CONSTRAINT "journal_entries_proxy_consistency" CHECK ((channel = 'proxy') = (proxy_user_id IS NOT NULL)),
	CONSTRAINT "journal_entries_revision_positive" CHECK (revision_no >= 1)
);
--> statement-breakpoint
CREATE TABLE "journal_entry_revisions" (
	"entry_id" uuid NOT NULL,
	"revision_no" smallint NOT NULL,
	"form_response_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "journal_entry_revisions_pk" PRIMARY KEY("entry_id","revision_no"),
	CONSTRAINT "journal_entry_revisions_form_response_id_unique" UNIQUE("form_response_id"),
	CONSTRAINT "journal_entry_revisions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "journal_ledger_runs" (
	"journal_date" date PRIMARY KEY NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"needs_resync" boolean DEFAULT false NOT NULL,
	"expected_count" integer,
	"missed_count" integer
);
--> statement-breakpoint
CREATE TABLE "journal_pauses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"reason" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "journal_pauses_reason_check" CHECK (reason IN ('leave', 'sickness', 'travel', 'bereavement', 'other')),
	CONSTRAINT "journal_pauses_dates" CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
--> statement-breakpoint
CREATE TABLE "journal_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text,
	"share_with_person" boolean DEFAULT false NOT NULL,
	"flagged_follow_up" boolean DEFAULT false NOT NULL,
	CONSTRAINT "journal_reviews_entry_reviewer" UNIQUE("entry_id","reviewer_user_id")
);
--> statement-breakpoint
CREATE TABLE "care_followups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_type" text,
	"source_ref" text,
	"assigned_to_person_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"visibility" text DEFAULT 'leadership' NOT NULL,
	"summary" text NOT NULL,
	"resolution_note" text,
	"dedupe_key" text,
	"due_on" date,
	"created_by" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_followups_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "care_followups_kind_check" CHECK (kind IN ('journal_missed_streak', 'journal_flagged', 'prayer_unconfirmed', 'serving_declined', 'registration_review', 'general')),
	CONSTRAINT "care_followups_status_check" CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
	CONSTRAINT "care_followups_visibility_check" CHECK (visibility IN ('leadership', 'pastoral'))
);
--> statement-breakpoint
ALTER TABLE "ministry_calendar_days" ADD CONSTRAINT "ministry_calendar_days_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_answer_sets" ADD CONSTRAINT "form_answer_sets_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_codes" ADD CONSTRAINT "entry_codes_leader_person_id_people_id_fk" FOREIGN KEY ("leader_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_codes" ADD CONSTRAINT "entry_codes_replaced_by_id_entry_codes_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."entry_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_codes" ADD CONSTRAINT "entry_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_keys" ADD CONSTRAINT "participant_keys_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_days" ADD CONSTRAINT "journal_days_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_days" ADD CONSTRAINT "journal_days_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_days" ADD CONSTRAINT "journal_days_leader_person_id_people_id_fk" FOREIGN KEY ("leader_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_days" ADD CONSTRAINT "journal_days_primary_leader_person_id_people_id_fk" FOREIGN KEY ("primary_leader_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_form_response_id_form_responses_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_entry_code_id_entry_codes_id_fk" FOREIGN KEY ("entry_code_id") REFERENCES "public"."entry_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_proxy_user_id_users_id_fk" FOREIGN KEY ("proxy_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_revisions" ADD CONSTRAINT "journal_entry_revisions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_revisions" ADD CONSTRAINT "journal_entry_revisions_form_response_id_form_responses_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_pauses" ADD CONSTRAINT "journal_pauses_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_pauses" ADD CONSTRAINT "journal_pauses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_reviews" ADD CONSTRAINT "journal_reviews_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_reviews" ADD CONSTRAINT "journal_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_followups" ADD CONSTRAINT "care_followups_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_followups" ADD CONSTRAINT "care_followups_assigned_to_person_id_people_id_fk" FOREIGN KEY ("assigned_to_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_followups" ADD CONSTRAINT "care_followups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_followups" ADD CONSTRAINT "care_followups_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_responses_person" ON "form_responses" USING btree ("person_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "form_one_published" ON "form_versions" USING btree ("form_id") WHERE status = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "form_one_draft" ON "form_versions" USING btree ("form_id") WHERE status = 'draft';--> statement-breakpoint
CREATE INDEX "action_tokens_person" ON "action_tokens" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "action_tokens_expiry" ON "action_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_code_active_leader" ON "entry_codes" USING btree ("leader_person_id") WHERE status = 'active' AND kind = 'journal_leader';--> statement-breakpoint
CREATE UNIQUE INDEX "entry_code_active_general" ON "entry_codes" USING btree ("kind") WHERE status = 'active' AND kind = 'journal_general';--> statement-breakpoint
CREATE INDEX "participant_keys_person" ON "participant_keys" USING btree ("person_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "journal_days_by_leader" ON "journal_days" USING btree ("journal_date","leader_person_id");--> statement-breakpoint
CREATE INDEX "journal_days_branch" ON "journal_days" USING gin ("journal_date","hierarchy_path");--> statement-breakpoint
CREATE INDEX "journal_days_open" ON "journal_days" USING btree ("journal_date") WHERE finalized_at IS NULL;--> statement-breakpoint
CREATE INDEX "journal_days_awaiting" ON "journal_days" USING btree ("leader_person_id","journal_date") WHERE review_status = 'awaiting';--> statement-breakpoint
CREATE INDEX "journal_pauses_person" ON "journal_pauses" USING btree ("person_id") WHERE cancelled_at IS NULL;--> statement-breakpoint
CREATE INDEX "care_open_by_assignee" ON "care_followups" USING btree ("assigned_to_person_id","created_at" DESC NULLS LAST) WHERE status IN ('open', 'in_progress');--> statement-breakpoint
CREATE INDEX "care_by_person" ON "care_followups" USING btree ("person_id","created_at" DESC NULLS LAST);