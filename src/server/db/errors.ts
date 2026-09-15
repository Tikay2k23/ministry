/** PostgreSQL error helpers that work for node-postgres, PGlite and drizzle-wrapped errors. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 4 && current; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (error: unknown) => pgCode(error) === '23505';
export const isForeignKeyViolation = (error: unknown) => pgCode(error) === '23503';
export const isCheckViolation = (error: unknown) => pgCode(error) === '23514';
/** GiST exclusion constraint (e.g. overlapping prayer slots or assignments). */
export const isExclusionViolation = (error: unknown) => pgCode(error) === '23P01';
