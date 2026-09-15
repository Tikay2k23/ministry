import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '@/server/db/client';
import { hierarchyNodes, importJobs, people } from '@/server/db/schema';
import { isConsistent, verifyHierarchy } from '@/server/modules/hierarchy/hierarchy.verify';
import { parseFlexibleDate, parsePeopleCsv } from '@/server/modules/import/people-import.parse';
import { commitPeopleImport, getImportJob, previewPeopleImport } from '@/server/modules/import/people-import.service';
import { createMinistry } from '@/server/modules/ministries/ministries.service';
import { createTestDatabase } from '../helpers/db';
import { buildWorld } from '../helpers/world';

let handle: DatabaseHandle;
let world: Awaited<ReturnType<typeof buildWorld>>;

beforeAll(async () => {
  handle = await createTestDatabase();
  world = await buildWorld(handle.db);
  await createMinistry(handle.db, world.admin, { name: 'Worship', code: 'WOR' });
});

afterAll(async () => {
  await handle.close();
});

const csv = (...lines: string[]) => lines.join('\n');

describe('CSV parsing helpers', () => {
  it('maps spreadsheet-style headers and ignores unknown columns', () => {
    const parsed = parsePeopleCsv(csv('First Name,Last Name,Mobile Number,Favourite Colour', 'Ana,Reyes,0917 111 2222,Blue'));
    expect(parsed.missingRequired).toEqual([]);
    expect(parsed.unknownColumns).toEqual(['favourite_colour']);
    expect(parsed.rows[0]).toEqual({ first_name: 'Ana', last_name: 'Reyes', mobile: '0917 111 2222' });
  });

  it('reads Philippine-style dates and birthdays without a year', () => {
    expect(parseFlexibleDate('03/14/1990')).toEqual({ year: 1990, month: 3, day: 14 });
    expect(parseFlexibleDate('1990-03-14')).toEqual({ year: 1990, month: 3, day: 14 });
    expect(parseFlexibleDate('07/21')).toEqual({ year: null, month: 7, day: 21 });
    expect(parseFlexibleDate('02/30/1990')).toBeNull();
  });
});

describe('people import', () => {
  it('previews, then imports a multi-level structure under an existing leader', async () => {
    const [mark] = await handle.db.select().from(people).where(eq(people.id, world.ids.mark));
    const file = csv(
      'ref,first_name,last_name,mobile,birthday,leader,ministry,designations,accepts_members',
      `L1,Paolo,Aquino,0917 300 0001,05/02/1988,${mark!.personCode},WOR,worker,yes`,
      'L2,Bea,Aquino,0917 300 0002,,L1,Worship,member,no',
      ',Carlo,Aquino,0917 300 0003,,Paolo Aquino,,member;worker,no',
      ',Dina,Aquino,not-a-phone,,L2,,,',
      'ROOT,Elias,Bautista,0917 300 0005,,,,pastor,yes',
      ',Faith,Bautista,0917 300 0006,,ROOT,,,',
      ',Gio,Loner,0917 300 0007,,,,,',
    );

    const { jobId, stats } = await previewPeopleImport(handle.db, world.admin, { fileName: 'members.csv', text: file });
    expect(stats).toMatchObject({ total: 7, error: 0, willCreate: 7, roots: 1, unplaced: 1 });

    const preview = await getImportJob(handle.db, world.admin, jobId);
    const dina = preview.rows.find((r) => r.name === 'Dina Aquino')!;
    expect(dina.outcome).toBe('warning'); // invalid phone is dropped, not fatal
    expect(preview.rows.find((r) => r.name === 'Gio Loner')!.placement).toBe('unplaced');

    const result = await commitPeopleImport(handle.db, world.admin, { jobId });
    expect(result).toEqual({ imported: 7, placed: 6 });

    const [paolo] = await handle.db.select().from(people).where(eq(people.firstName, 'Paolo'));
    const [paoloNode] = await handle.db.select().from(hierarchyNodes).where(eq(hierarchyNodes.personId, paolo!.id));
    expect(paoloNode).toMatchObject({ parentPersonId: world.ids.mark, acceptsMembers: true });
    expect(isConsistent(await verifyHierarchy(handle.db, 1))).toBe(true);

    const [job] = await handle.db.select().from(importJobs).where(eq(importJobs.id, jobId));
    expect(job!.status).toBe('completed');
    await expect(commitPeopleImport(handle.db, world.admin, { jobId })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('never guesses: ambiguous, missing and circular leaders are errors', async () => {
    const file = csv(
      'ref,first_name,last_name,mobile,leader',
      ',Hana,Ortiz,0917 400 0001,Nobody Known',
      'A,Ivan,Ortiz,0917 400 0002,B',
      'B,Jade,Ortiz,0917 400 0003,A',
      ',Kiko,Ortiz,0917 400 0004,A',
      ',Lara,,0917 400 0005,',
    );
    const { jobId, stats } = await previewPeopleImport(handle.db, world.admin, { fileName: 'bad.csv', text: file });
    expect(stats).toMatchObject({ total: 5, error: 5, willCreate: 0 });

    const preview = await getImportJob(handle.db, world.admin, jobId, { outcome: 'error' });
    const messagesFor = (name: string) => preview.rows.find((r) => r.name.startsWith(name))!.messages.map((m) => m.message).join(' ');
    expect(messagesFor('Hana')).toContain('was not found');
    expect(messagesFor('Ivan')).toContain('Circular leadership');
    expect(messagesFor('Kiko')).toContain('can’t be imported');
    expect(messagesFor('Lara')).toContain('Last name is required');
  });

  it('recognises people already in the directory and duplicates within the file', async () => {
    const file = csv(
      'first_name,last_name,mobile,email,leader',
      'Paolo,Aquino,0917 300 0001,,',
      'Nora,Diaz,0917 500 0001,nora@example.org,',
      'Nora,Diaz,0917 500 0001,nora@example.org,',
    );
    const { stats } = await previewPeopleImport(handle.db, world.admin, { fileName: 'dupes.csv', text: file });
    expect(stats).toMatchObject({ duplicate: 1, error: 1, willCreate: 1 });
  });

  it('rejects files without the required columns and non-administrators', async () => {
    await expect(
      previewPeopleImport(handle.db, world.admin, { fileName: 'x.csv', text: csv('name,mobile', 'Ana Reyes,0917 111 2222') }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      previewPeopleImport(handle.db, world.markCtx, { fileName: 'x.csv', text: csv('first_name,last_name', 'Ana,Reyes') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
