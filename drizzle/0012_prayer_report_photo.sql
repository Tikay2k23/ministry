CREATE TABLE "prayer_report_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"response_id" uuid,
	"person_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"deleted_file_at" timestamp with time zone,
	CONSTRAINT "prayer_report_attachments_path" UNIQUE("storage_bucket","storage_path"),
	CONSTRAINT "prayer_report_attachments_status_check" CHECK (status IN ('pending', 'attached', 'removed')),
	CONSTRAINT "prayer_report_attachments_mime_check" CHECK (mime_type IN ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "prayer_report_attachments_size" CHECK (file_size_bytes > 0),
	CONSTRAINT "prayer_report_attachments_pending_unattached" CHECK (status <> 'pending' OR (response_id IS NULL AND attached_at IS NULL)),
	CONSTRAINT "prayer_report_attachments_attached_complete" CHECK (status <> 'attached' OR (response_id IS NOT NULL AND attached_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "prayer_chains" ADD COLUMN "report_photo" text DEFAULT 'optional' NOT NULL;--> statement-breakpoint
ALTER TABLE "prayer_report_attachments" ADD CONSTRAINT "prayer_report_attachments_assignment_id_prayer_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."prayer_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_report_attachments" ADD CONSTRAINT "prayer_report_attachments_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_report_attachments" ADD CONSTRAINT "prayer_report_attachments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_report_attachments" ADD CONSTRAINT "prayer_report_attachments_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prayer_report_attachments_one_photo" ON "prayer_report_attachments" USING btree ("response_id") WHERE status = 'attached';--> statement-breakpoint
CREATE INDEX "prayer_report_attachments_pending" ON "prayer_report_attachments" USING btree ("created_at") WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE "prayer_chains" ADD CONSTRAINT "prayer_chains_report_photo_check" CHECK (report_photo IN ('required', 'optional', 'off'));--> statement-breakpoint
-- Row-level security for the new table, as for every table (see drizzle/0007_row_level_security.sql).
ALTER TABLE "prayer_report_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "prayer_report_attachments" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);
