import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { setAcceptsMembers } from '@/server/modules/hierarchy/hierarchy.service';
import { inviteUser } from '@/server/modules/iam/users.service';
import { branchQrCards, getGeneralQrCode, listQrCodes } from '@/server/modules/public/qr-codes.service';
import { recordEntryCodeScan, resolveEntryCode } from '@/server/modules/public/entry-codes.service';
import { createTestDatabase } from '../helpers/db';
import { buildWorld, contextFor } from '../helpers/world';

/**
 * QR codes for the office (docs/04 A27, docs/06 row 32). The fixture ministry:
 *   Eduardo (pastor) ─┬─ Michael (primary) ── Mark (leader) ── John
 *                     └─ Samuel (primary) ── Anna (leader) ── Grace
 */

let handle: DatabaseHandle;
let world: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  handle = await createTestDatabase();
  world = await buildWorld(handle.db);
  for (const personId of [world.ids.michael, world.ids.mark, world.ids.anna]) {
    await setAcceptsMembers(handle.db, world.admin, { personId, acceptsMembers: true });
  }
});

afterAll(async () => {
  await handle.close();
});

describe('QR codes', () => {
  it('lists the general code, the leaders who receive people, and the branches to print for', async () => {
    const codes = await listQrCodes(handle.db, world.admin);
    expect(codes.general?.url).toMatch(/\/j\/[0-9A-Z]{8}$/);
    expect(codes.leaders.map((l) => l.name).sort()).toEqual(['Anna Lim', 'Mark Santos', 'Michael Reyes']);
    expect(codes.leaders.every((l) => !l.printed && l.scans === 0)).toBe(true);
    expect(codes.leaders.find((l) => l.name === 'Mark Santos')?.branchName).toBe('Michael Reyes');
    expect(codes.branches).toEqual([
      { personId: world.ids.michael, name: 'Michael Reyes', leaders: 2 },
      { personId: world.ids.samuel, name: 'Samuel Torres', leaders: 1 },
    ]);
  });

  it('prints cards for one branch only, creating each code once', async () => {
    const first = await branchQrCards(handle.db, world.admin, { personId: world.ids.michael });
    expect(first.branchName).toBe('Michael Reyes');
    expect(first.cards.map((c) => c.name)).toEqual(['Michael Reyes', 'Mark Santos']);

    const again = await branchQrCards(handle.db, world.admin, { personId: world.ids.michael });
    expect(again.cards.map((c) => c.url)).toEqual(first.cards.map((c) => c.url));

    // Each card opens the journal with its own leader chosen.
    const code = first.cards[1]!.url.split('/j/')[1]!;
    expect((await resolveEntryCode(handle.db, code))?.leader?.personId).toBe(world.ids.mark);

    // A scan shows up with a real date (raw rows can carry timestamps as strings).
    const resolved = await resolveEntryCode(handle.db, code);
    await recordEntryCodeScan(handle.db, resolved!.id, new Date('2026-09-17T08:30:00Z'));

    const codes = await listQrCodes(handle.db, world.admin);
    expect(codes.leaders.filter((l) => l.printed).map((l) => l.name).sort()).toEqual(['Mark Santos', 'Michael Reyes']);
    const mark = codes.leaders.find((l) => l.name === 'Mark Santos')!;
    expect(mark.scans).toBe(1);
    expect(mark.lastScannedAt).toBeInstanceOf(Date);
    expect(mark.lastScannedAt?.toISOString()).toBe('2026-09-17T08:30:00.000Z');
    expect(codes.general?.lastScannedAt).toBeNull();
  });

  it('is for the office: leaders print only their own card from their profile (row 32)', async () => {
    await expect(listQrCodes(handle.db, world.markCtx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(branchQrCards(handle.db, world.markCtx, { personId: world.ids.michael })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(getGeneralQrCode(handle.db, world.markCtx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(branchQrCards(handle.db, world.admin, { personId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets a Primary Leader choose who in their own branch receives new people (FR-LDR-08)', async () => {
    const { userId } = await inviteUser(handle.db, world.admin, { personId: world.ids.michael, email: 'michael@gentouch.test', roleKey: 'primary_leader' });
    const michaelCtx = await contextFor(handle.db, userId);

    await setAcceptsMembers(handle.db, michaelCtx, { personId: world.ids.mark, acceptsMembers: false });
    expect((await listQrCodes(handle.db, world.admin)).leaders.map((l) => l.name)).not.toContain('Mark Santos');
    await setAcceptsMembers(handle.db, michaelCtx, { personId: world.ids.mark, acceptsMembers: true });
    expect((await listQrCodes(handle.db, world.admin)).leaders.map((l) => l.name)).toContain('Mark Santos');

    // Another branch is out of sight, and a Leader can't change it at all.
    await expect(setAcceptsMembers(handle.db, michaelCtx, { personId: world.ids.anna, acceptsMembers: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(setAcceptsMembers(handle.db, world.markCtx, { personId: world.ids.john, acceptsMembers: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
