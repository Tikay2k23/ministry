import { sql } from 'drizzle-orm';
import { queryRows, type Executor } from '../../db/client';
import { personDuplicateCandidates } from '../../db/schema';

/**
 * Duplicate detection (docs/01 FR-PPL-06, BR-P-03). Candidates are raised, never merged
 * automatically. Name similarity alone is always weak: many people share names.
 */

export type DuplicateReason = 'same_phone' | 'same_email' | 'similar_name';

export interface DuplicateMatch {
  personId: string;
  personCode: string;
  firstName: string;
  lastName: string;
  reasons: DuplicateReason[];
  /** strong: same email, or same phone + similar first name · medium: shared phone · weak: similar name */
  strength: 'strong' | 'medium' | 'weak';
  score: number;
}

export interface DuplicateProbe {
  firstName: string;
  lastName: string;
  middleName?: string | null;
  preferredName?: string | null;
  phoneE164?: string | null;
  email?: string | null;
  excludePersonId?: string;
}

export async function findDuplicateMatches(executor: Executor, probe: DuplicateProbe): Promise<DuplicateMatch[]> {
  const rows = await queryRows<{
    id: string;
    person_code: string;
    first_name: string;
    last_name: string;
    same_phone: boolean;
    same_email: boolean;
    name_similarity: number;
    first_similarity: number;
  }>(
    executor,
    sql`
    WITH probe AS (
      SELECT lower(immutable_unaccent(${probe.firstName} || ' ' || coalesce(${probe.preferredName ?? null}::text, '') || ' ' ||
                   coalesce(${probe.middleName ?? null}::text, '') || ' ' || ${probe.lastName})) AS name,
             lower(immutable_unaccent(${probe.firstName})) AS first
    )
    SELECT p.id, p.person_code, p.first_name, p.last_name,
           coalesce(p.phone_e164 = ${probe.phoneE164 ?? null}::text, false) AS same_phone,
           coalesce(p.email = ${probe.email ?? null}::citext, false) AS same_email,
           similarity(p.search_name, probe.name) AS name_similarity,
           similarity(lower(immutable_unaccent(p.first_name)), probe.first) AS first_similarity
      FROM people p, probe
     WHERE p.archived_at IS NULL
       AND (${probe.excludePersonId ?? null}::uuid IS NULL OR p.id <> ${probe.excludePersonId ?? null}::uuid)
       AND (p.phone_e164 = ${probe.phoneE164 ?? null}::text
            OR p.email = ${probe.email ?? null}::citext
            OR (p.search_name % probe.name AND similarity(p.search_name, probe.name) >= 0.6))
     ORDER BY same_email DESC, same_phone DESC, name_similarity DESC
     LIMIT 10`,
  );

  return rows.map((r) => {
    const reasons: DuplicateReason[] = [];
    if (r.same_phone) reasons.push('same_phone');
    if (r.same_email) reasons.push('same_email');
    if (Number(r.name_similarity) >= 0.6) reasons.push('similar_name');
    const strength: DuplicateMatch['strength'] =
      r.same_email || (r.same_phone && Number(r.first_similarity) >= 0.5) ? 'strong' : r.same_phone ? 'medium' : 'weak';
    const score = strength === 'strong' ? 0.95 : strength === 'medium' ? 0.7 : Math.min(0.69, Number(r.name_similarity));
    return {
      personId: r.id,
      personCode: r.person_code,
      firstName: r.first_name,
      lastName: r.last_name,
      reasons,
      strength,
      score: Math.round(score * 1000) / 1000,
    };
  });
}

/** Stores matches in the review queue (one row per unordered pair). */
export async function recordDuplicateCandidates(executor: Executor, personId: string, matches: DuplicateMatch[]) {
  if (matches.length === 0) return;
  await executor
    .insert(personDuplicateCandidates)
    .values(
      matches.map((m) => {
        const [a, b] = [personId, m.personId].sort();
        return { personAId: a!, personBId: b!, reasons: m.reasons, score: m.score.toFixed(3) };
      }),
    )
    .onConflictDoNothing();
}
