import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { actorUserId, type RequestContext } from '../../context/request-context';
import { queryRows, type Database } from '../../db/client';
import type { PrayerChainStatus } from '../../db/enums';
import { notFound } from '../../errors';
import { assertGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { ensureLeaderEntryCode, journalUrlForCode, prayerUrlForCode } from './entry-codes.service';

/**
 * QR codes for the office (docs/04 A27, docs/06 row 32: `links.manage`). Leaders print their own
 * card from their profile (`links.own.manage`) and chain coordinators from the chain's setup page.
 *
 * A leader's code is created the first time it's printed. Only leaders who receive new people
 * (`accepts_members`) are listed: the journal page turns a new person away from anyone else's code.
 */

const name = (first: string, last: string) => `${first} ${last}`;
/** Raw queries return timestamps as strings on some drivers (PGlite): always hand pages a Date. */
const toDate = (value: Date | string | null) => (value === null ? null : new Date(value));

export async function listQrCodes(db: Database, ctx: RequestContext) {
  assertGlobal(ctx, 'links.manage');
  const [general, leaders, branches, chains] = await Promise.all([
    queryRows<{ code: string; scan_count: number; last_scanned_at: Date | string | null }>(
      db,
      sql`SELECT code, scan_count, last_scanned_at FROM entry_codes WHERE kind = 'journal_general' AND status = 'active' LIMIT 1`,
    ),
    queryRows<{
      person_id: string;
      first_name: string;
      last_name: string;
      branch_person_id: string | null;
      branch_first_name: string | null;
      branch_last_name: string | null;
      code: string | null;
      scan_count: number | null;
      last_scanned_at: Date | string | null;
    }>(
      db,
      sql`SELECT n.person_id, p.first_name, p.last_name, n.primary_leader_person_id AS branch_person_id, pl.first_name AS branch_first_name, pl.last_name AS branch_last_name,
                 ec.code, ec.scan_count, ec.last_scanned_at
            FROM hierarchy_nodes n
            JOIN people p ON p.id = n.person_id AND p.archived_at IS NULL
            LEFT JOIN people pl ON pl.id = n.primary_leader_person_id
            LEFT JOIN entry_codes ec ON ec.leader_person_id = n.person_id AND ec.kind = 'journal_leader' AND ec.status = 'active'
           WHERE n.accepts_members
           ORDER BY pl.last_name NULLS FIRST, pl.first_name, n.depth, p.last_name, p.first_name`,
    ),
    queryRows<{ person_id: string; first_name: string; last_name: string; leaders: number }>(
      db,
      sql`SELECT b.person_id, p.first_name, p.last_name,
                 (SELECT count(*)::int
                    FROM hierarchy_closure c
                    JOIN hierarchy_nodes d ON d.person_id = c.descendant_id AND d.accepts_members
                    JOIN people dp ON dp.id = d.person_id AND dp.archived_at IS NULL
                   WHERE c.ancestor_id = b.person_id) AS leaders
            FROM hierarchy_nodes b
            JOIN people p ON p.id = b.person_id AND p.archived_at IS NULL
           WHERE b.primary_leader_person_id = b.person_id
           ORDER BY p.last_name, p.first_name`,
    ),
    queryRows<{ id: string; name: string; status: PrayerChainStatus; code: string | null; scan_count: number | null; last_scanned_at: Date | string | null }>(
      db,
      sql`SELECT c.id, c.name, c.status, ec.code, ec.scan_count, ec.last_scanned_at
            FROM prayer_chains c
            LEFT JOIN entry_codes ec ON ec.prayer_chain_id = c.id AND ec.kind = 'prayer_chain' AND ec.status = 'active'
           WHERE c.status <> 'ended'
           ORDER BY c.name`,
    ),
  ]);

  return {
    general: general[0]
      ? { url: journalUrlForCode(general[0].code), scans: general[0].scan_count, lastScannedAt: toDate(general[0].last_scanned_at) }
      : null,
    leaders: leaders.map((row) => ({
      personId: row.person_id,
      name: name(row.first_name, row.last_name),
      branchPersonId: row.branch_person_id,
      branchName: row.branch_first_name && row.branch_last_name ? name(row.branch_first_name, row.branch_last_name) : null,
      printed: row.code !== null,
      scans: row.scan_count ?? 0,
      lastScannedAt: toDate(row.last_scanned_at),
    })),
    branches: branches.map((row) => ({ personId: row.person_id, name: name(row.first_name, row.last_name), leaders: row.leaders })),
    chains: chains.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      url: row.code ? prayerUrlForCode(row.code) : null,
      scans: row.scan_count ?? 0,
      lastScannedAt: toDate(row.last_scanned_at),
    })),
  };
}

export async function getGeneralQrCode(db: Database, ctx: RequestContext) {
  assertGlobal(ctx, 'links.manage');
  const [row] = await queryRows<{ code: string }>(db, sql`SELECT code FROM entry_codes WHERE kind = 'journal_general' AND status = 'active' LIMIT 1`);
  if (!row) throw notFound('general journal code');
  return { url: journalUrlForCode(row.code) };
}

export const BranchCardsInput = z.object({ personId: z.uuid() });

/** A card for every leader in a branch who receives new people, top of the branch first. */
export async function branchQrCards(db: Database, ctx: RequestContext, raw: unknown) {
  assertGlobal(ctx, 'links.manage');
  const { personId } = parseInput(BranchCardsInput, raw);
  const [head] = await queryRows<{ first_name: string; last_name: string }>(
    db,
    sql`SELECT p.first_name, p.last_name FROM hierarchy_nodes n JOIN people p ON p.id = n.person_id AND p.archived_at IS NULL WHERE n.person_id = ${personId}::uuid`,
  );
  if (!head) throw notFound('leader');

  const leaders = await queryRows<{ person_id: string; first_name: string; last_name: string }>(
    db,
    sql`SELECT d.person_id, p.first_name, p.last_name
          FROM hierarchy_closure c
          JOIN hierarchy_nodes d ON d.person_id = c.descendant_id AND d.accepts_members
          JOIN people p ON p.id = d.person_id AND p.archived_at IS NULL
         WHERE c.ancestor_id = ${personId}::uuid
         ORDER BY c.depth, p.last_name, p.first_name`,
  );
  const cards = [];
  for (const leader of leaders) {
    const code = await ensureLeaderEntryCode(db, leader.person_id, actorUserId(ctx));
    cards.push({ personId: leader.person_id, name: name(leader.first_name, leader.last_name), url: journalUrlForCode(code.code) });
  }
  return { branchName: name(head.first_name, head.last_name), cards };
}
