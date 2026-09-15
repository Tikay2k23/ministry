import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gin } from '@electric-sql/pglite/contrib/btree_gin';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import type { SQL } from 'drizzle-orm';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
/** Driver-agnostic database type used by every service. */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

/** PostgreSQL extensions the schema requires (see drizzle/0000_extensions.sql). */
const PGLITE_EXTENSIONS = { citext, pg_trgm, unaccent, btree_gist, btree_gin };

/**
 * Opens a database from a URL:
 * - `postgres://…` / `postgresql://…` → node-postgres pool (staging/production)
 * - `pglite://<dir>` → embedded PostgreSQL persisted to <dir> (local development)
 * - `pglite://memory` → in-memory embedded PostgreSQL (tests)
 */
export function openDatabase(url: string): DatabaseHandle {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = drizzleNodePg(pool, { schema }) as unknown as Database;
    return { db, kind: 'postgres', close: () => pool.end() };
  }
  if (url.startsWith('pglite:')) {
    const location = url.slice('pglite:'.length).replace(/^\/\//, '');
    const inMemory = location === '' || location === 'memory';
    // PGlite creates its data directory but not missing parents (e.g. `.data/`).
    if (!inMemory) mkdirSync(path.dirname(path.resolve(location)), { recursive: true });
    const client = new PGlite({
      dataDir: inMemory ? undefined : location,
      extensions: PGLITE_EXTENSIONS,
    });
    const db = drizzlePglite(client, { schema }) as unknown as Database;
    return { db, kind: 'pglite', close: () => client.close() };
  }
  throw new Error('DATABASE_URL must start with postgres://, postgresql:// or pglite:');
}

/** Runs a raw query and returns its rows (works for both drivers). */
export async function queryRows<T>(executor: Executor, query: SQL): Promise<T[]> {
  const result = (await executor.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}
