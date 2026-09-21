CREATE TABLE "journal_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid,
	"person_id" uuid NOT NULL,
	"kind" text DEFAULT 'proof' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"checksum" text NOT NULL,
	"uploaded_via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"deleted_file_at" timestamp with time zone,
	CONSTRAINT "journal_attachments_path" UNIQUE("storage_bucket","storage_path"),
	CONSTRAINT "journal_attachments_kind_check" CHECK (kind IN ('proof')),
	CONSTRAINT "journal_attachments_status_check" CHECK (status IN ('pending', 'attached', 'removed')),
	CONSTRAINT "journal_attachments_mime_check" CHECK (mime_type IN ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "journal_attachments_size" CHECK (file_size_bytes > 0),
	CONSTRAINT "journal_attachments_pending_unattached" CHECK (status <> 'pending' OR (entry_id IS NULL AND attached_at IS NULL)),
	CONSTRAINT "journal_attachments_attached_complete" CHECK (status <> 'attached' OR (entry_id IS NOT NULL AND attached_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_attachments_one_proof" ON "journal_attachments" USING btree ("entry_id","kind") WHERE status = 'attached';--> statement-breakpoint
CREATE INDEX "journal_attachments_pending" ON "journal_attachments" USING btree ("created_at") WHERE status = 'pending';--> statement-breakpoint
-- Row-level security for the new table, as for every table (see drizzle/0007_row_level_security.sql).
ALTER TABLE "journal_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY gentouch_app_full_access ON "journal_attachments" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);