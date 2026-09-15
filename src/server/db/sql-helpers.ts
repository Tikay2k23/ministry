import { getTableName, is, SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * A fully qualified column reference ("table"."column").
 *
 * Drizzle renders columns inside `sql` templates WITHOUT the table name when a query selects
 * from a single table. Inside a correlated subquery an unqualified name can bind to the
 * subquery's own column instead — e.g. `hc.descendant_id = "ancestor_id"` — which silently
 * changes the meaning of a permission filter. Always use this for outer references in subqueries.
 */
export function qualified(column: AnyPgColumn): SQL {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}

/** Accepts either a raw SQL expression or a column, returning a safe reference. */
export function columnRef(value: SQL | AnyPgColumn): SQL {
  return is(value, SQL) ? value : qualified(value);
}
