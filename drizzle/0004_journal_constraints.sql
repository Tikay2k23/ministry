-- Hand-written migration: things drizzle-kit cannot express.

-- Rate-limit counters are ephemeral: skip WAL (faster; losing them on a crash is acceptable).
ALTER TABLE rate_limit_buckets SET UNLOGGED;
--> statement-breakpoint
-- A person cannot have two active pauses covering the same day (docs/03 §4.7).
ALTER TABLE journal_pauses
  ADD CONSTRAINT journal_pauses_no_overlap
  EXCLUDE USING gist (
    person_id WITH =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]') WITH &&
  ) WHERE (cancelled_at IS NULL);
