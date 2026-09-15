-- Prayer chain overlap rules (docs/03 §4.11, BR-PR-01). GiST exclusion constraints need btree_gist (migration 0000).
-- Slots in one chain never overlap while open.
ALTER TABLE prayer_slots ADD CONSTRAINT prayer_slots_no_overlap EXCLUDE USING gist (prayer_chain_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'open');
--> statement-breakpoint
-- One person never holds overlapping assignments, across all chains.
ALTER TABLE prayer_assignments ADD CONSTRAINT prayer_assignments_no_person_overlap EXCLUDE USING gist (person_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status NOT IN ('replaced', 'cancelled', 'excused'));
