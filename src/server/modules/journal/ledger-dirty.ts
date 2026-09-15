import { isNull } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { journalLedgerRuns } from '../../db/schema';

/**
 * Flags open journal days for re-synchronisation (docs/01 BR-H-05). Called in the same
 * transaction as any change that affects who is expected or who leads whom; the ledger
 * applies it the next time it is maintained. Kept dependency-free to avoid import cycles.
 */
export async function markJournalLedgerDirty(executor: Executor): Promise<void> {
  await executor.update(journalLedgerRuns).set({ needsResync: true }).where(isNull(journalLedgerRuns.closedAt));
}
