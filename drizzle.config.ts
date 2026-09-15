import { defineConfig } from 'drizzle-kit';

/**
 * `npm run db:generate` diffs the TypeScript schema against the last snapshot and writes SQL
 * migrations to ./drizzle. Generated SQL is always reviewed before commit (docs/07 §7).
 * Hand-written migrations (extensions, functions, exclusion constraints) are created with
 * `npx drizzle-kit generate --custom --name <name>`.
 *
 * Column names are always given explicitly in snake_case in the schema (no automatic casing),
 * so SQL in CHECK constraints and partial indexes can reference them unambiguously.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
