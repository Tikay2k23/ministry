-- Hand-written migration: extensions and helper functions required by the schema.
-- On managed PostgreSQL this must run as a role allowed to CREATE EXTENSION (DATABASE_URL_MIGRATOR).
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;
--> statement-breakpoint
-- unaccent() is STABLE; generated columns and indexes require an IMMUTABLE function.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
