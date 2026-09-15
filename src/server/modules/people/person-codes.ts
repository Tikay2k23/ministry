import { inArray } from 'drizzle-orm';
import { newPersonCode } from '@/lib/ids';
import type { Executor } from '../../db/client';
import { people } from '../../db/schema';

/**
 * Generates `count` person codes that are unique within the batch and not yet used in the
 * database. A unique-violation inside a transaction would abort it (e.g. a whole import),
 * so collisions are checked up front.
 */
export async function generatePersonCodes(executor: Executor, count: number): Promise<string[]> {
  const codes = new Set<string>();
  while (codes.size < count) {
    const batch = new Set<string>();
    while (batch.size < count - codes.size) {
      const code = newPersonCode();
      if (!codes.has(code)) batch.add(code);
    }
    const taken = await executor
      .select({ code: people.personCode })
      .from(people)
      .where(inArray(people.personCode, [...batch]));
    const takenSet = new Set(taken.map((t) => t.code));
    for (const code of batch) if (!takenSet.has(code)) codes.add(code);
  }
  return [...codes];
}
