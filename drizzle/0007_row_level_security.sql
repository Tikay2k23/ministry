-- Row-level security baseline (stack alignment, September 2026; docs/02 §8, docs/03).
--
-- 1. Every table in `public` gets row-level security. A database role without a policy sees no
--    rows and can write none, so the Supabase Data API roles (anon, authenticated) can never read
--    ministry data, even if a table privilege is granted by mistake.
-- 2. The application role `gentouch_app` gets one permissive policy per table, so the server keeps
--    working when it connects as a least-privilege login role (docs/02 §8: `app_rw`, created with
--    `GRANT gentouch_app TO app_rw`). Table owners (local development, tests, migrations and the
--    Supabase `postgres` role) bypass row-level security anyway.
-- 3. Audit entries are insert-only for the application role.
-- 4. On Supabase, the Data API roles lose every privilege on tables and sequences in `public`.
--
-- Authorization itself stays in the application (the policy layer and its tests). Scoped,
-- per-actor policies on content tables are planned for V1 and will replace the permissive policy
-- on those tables.
--
-- Every NEW table needs the same two statements in its migration (tests/integration/schema.test.ts checks):
--   ALTER TABLE "new_table" ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY gentouch_app_full_access ON "new_table" AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true);
-- Its privileges for gentouch_app follow automatically from the default privileges below.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gentouch_app') THEN
    CREATE ROLE gentouch_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO gentouch_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gentouch_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gentouch_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_logs FROM gentouch_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gentouch_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gentouch_app;
--> statement-breakpoint
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format(
      'CREATE POLICY gentouch_app_full_access ON public.%I AS PERMISSIVE FOR ALL TO gentouch_app USING (true) WITH CHECK (true)',
      t.relname
    );
  END LOOP;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
