import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { createPerson } from '@/server/modules/people/people.service';
import { exportPeopleDirectory } from '@/server/modules/reports/people-export.service';
import { createTestDatabase } from '../helpers/db';
import { globalGrant, userContext } from '../helpers/fixtures';
import { buildWorld } from '../helpers/world';

let handle: DatabaseHandle;
let db: DatabaseHandle['db'];
let world: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
  world = await buildWorld(db);
  await createPerson(db, world.admin, { firstName: '=HYPERLINK("x")', lastName: 'Tester', leaderId: world.ids.mark });
});

afterAll(async () => {
  await handle.close();
});

describe('people directory export', () => {
  it('exports the directory for the office with readable labels and neutralised formulas', async () => {
    const { filename, csv } = await exportPeopleDirectory(db, world.admin, {});
    const lines = csv.split('\r\n');
    expect(filename).toBe('people-2026-09-12.csv');
    expect(lines[0]).toBe(
      '﻿Person code,First name,Last name,Preferred name,Status,Registration,Leader,Primary leader,Level,Ministry,Mobile,Email,Joined',
    );
    expect(lines.some((l) => l.includes(',John,Cruz,,Active,Confirmed,Mark Santos,Michael Reyes,'))).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('keeps a leader’s export to their own branch and applies directory filters', async () => {
    const { csv } = await exportPeopleDirectory(db, world.markCtx, {});
    expect(csv).toContain(',John,Cruz,');
    expect(csv).not.toContain(',Grace,Mendoza,');

    const filtered = await exportPeopleDirectory(db, world.admin, { q: 'grace' });
    expect(filtered.csv.split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  it('requires the export permission', async () => {
    const adminUserId = world.admin.actor.kind === 'user' ? world.admin.actor.userId : '';
    const viewer = userContext({ id: adminUserId }, [globalGrant('people.view')]);
    await expect(exportPeopleDirectory(db, viewer, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
