import { count, eq, inArray, like } from 'drizzle-orm';
import { newId } from '@/lib/ids';
import type { Database } from '../client';
import {
  departments,
  hierarchyClosure,
  hierarchyNodes,
  leadershipHistory,
  ministries,
  ministryMemberships,
  people,
  personDesignations,
  roles,
  teamMemberships,
  teams,
  userRoleAssignments,
  users,
} from '../schema';
import { lockHierarchy } from '../../modules/hierarchy/hierarchy.core';
import { isConsistent, verifyHierarchy } from '../../modules/hierarchy/hierarchy.verify';
import { generatePersonCodes } from '../../modules/people/person-codes';
import { getSetting } from '../../modules/settings/settings.service';

/**
 * DEMO DATA ONLY — a realistic ministry for development and demos:
 * 1 pastor → 12 Primary Leaders → 144 Leaders → 1,728 members (1,885 people), ministries,
 * worship teams, and two demo portal accounts to try scoped views.
 * All names are fictional; mobile numbers use the unallocated +63 900 range; emails use
 * demo.gentouch.test. Never run against production (the script refuses).
 */

export const DEMO_EMAIL_DOMAIN = 'demo.gentouch.test';

const MALE = ['Juan', 'Jose', 'Mark', 'John', 'Paolo', 'Carlo', 'Miguel', 'Rafael', 'Joshua', 'Daniel', 'Gabriel', 'Angelo', 'Christian', 'Jericho', 'Kevin', 'Ramon', 'Noel', 'Arnel', 'Rodel', 'Jerome', 'Adrian', 'Bryan', 'Dennis', 'Francis', 'Gilbert', 'Harold', 'Ivan', 'Jomar', 'Leo', 'Emil'];
const FEMALE = ['Maria', 'Ana', 'Grace', 'Joy', 'Kristine', 'Angela', 'Camille', 'Patricia', 'Jasmine', 'Nicole', 'Rhea', 'Liza', 'Maricel', 'Jennifer', 'Hazel', 'Irene', 'Lovely', 'Mae', 'Bea', 'Faith', 'Hope', 'Charity', 'Cherry', 'Divine', 'Precious', 'April', 'Joanna', 'Katrina', 'Lea', 'Sheila'];
const SURNAMES = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Tomas', 'Andrada', 'Castillo', 'Flores', 'Villanueva', 'Ramos', 'Castro', 'Rivera', 'Aquino', 'Navarro', 'Salazar', 'Mercado', 'Dela Cruz', 'De Leon', 'Gonzales', 'Aguilar', 'Lopez', 'Pascual', 'Soriano', 'Manalo', 'Valdez', 'Domingo', 'Peña', 'Dizon', 'Sison', 'Lim', 'Tan'];

/** Deterministic PRNG so the demo looks the same on every machine. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PlannedPerson {
  id: string;
  firstName: string;
  lastName: string;
  gender: 'male' | 'female';
  parentId: string | null;
  depth: number;
  kind: 'pastor' | 'primary' | 'leader' | 'member';
  email: string | null;
}

async function insertChunks<T>(rows: T[], size: number, insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

export async function seedDemoData(db: Database): Promise<{ created: boolean; people: number; accounts: string[] }> {
  const [existing] = await db.select({ n: count() }).from(people).where(like(people.email, `%@${DEMO_EMAIL_DOMAIN}`));
  if ((existing?.n ?? 0) > 0) return { created: false, people: 0, accounts: [] };

  return db.transaction(async (tx) => {
    await lockHierarchy(tx);
    const { primaryLeaderDepth, leaderStatusDepth } = await getSetting(tx, 'hierarchy');
    const rand = mulberry32(20260914);
    const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)]!;

    // ── Ministries ────────────────────────────────────────────────────────────
    const ministryDefs = [
      { code: 'WOR', name: 'Worship' },
      { code: 'PRY', name: 'Prayer' },
      { code: 'YTH', name: 'Youth' },
      { code: 'KID', name: 'Kids' },
      { code: 'MED', name: 'Media' },
      { code: 'HOS', name: 'Hospitality' },
    ];
    const existingMinistries = await tx.select().from(ministries).where(inArray(ministries.code, ministryDefs.map((m) => m.code)));
    const ministryIds = new Map(existingMinistries.map((m) => [m.code, m.id]));
    for (const def of ministryDefs.filter((d) => !ministryIds.has(d.code))) {
      const id = newId();
      await tx.insert(ministries).values({ id, ...def });
      ministryIds.set(def.code, id);
    }
    const worshipId = ministryIds.get('WOR')!;
    const musicDeptId = newId();
    await tx.insert(departments).values({ id: musicDeptId, ministryId: worshipId, name: 'Music' }).onConflictDoNothing();
    const teamIds = ['Team A', 'Team B', 'Team C'].map(() => newId());
    await tx.insert(teams).values(
      teamIds.map((id, i) => ({ id, ministryId: worshipId, departmentId: musicDeptId, name: `Demo Team ${'ABC'[i]}`, teamType: 'worship' as const })),
    );

    // ── People and the tree ───────────────────────────────────────────────────
    const planned: PlannedPerson[] = [];
    const person = (parentId: string | null, depth: number, kind: PlannedPerson['kind'], gender: 'male' | 'female', email: string | null = null) => {
      const p: PlannedPerson = {
        id: newId(),
        firstName: pick(gender === 'male' ? MALE : FEMALE),
        lastName: pick(SURNAMES),
        gender,
        parentId,
        depth,
        kind,
        email,
      };
      planned.push(p);
      return p;
    };

    const pastor = person(null, 0, 'pastor', 'male', `pastor@${DEMO_EMAIL_DOMAIN}`);
    for (let i = 0; i < 12; i++) {
      const gender = i % 2 === 0 ? 'male' : 'female';
      const primary = person(pastor.id, 1, 'primary', gender, i === 0 ? `primary.leader@${DEMO_EMAIL_DOMAIN}` : null);
      for (let j = 0; j < 12; j++) {
        const leader = person(primary.id, 2, 'leader', gender, i === 0 && j === 0 ? `leader@${DEMO_EMAIL_DOMAIN}` : null);
        for (let k = 0; k < 12; k++) person(leader.id, 3, 'member', gender);
      }
    }

    const codes = await generatePersonCodes(tx, planned.length);
    await insertChunks(planned, 500, (chunk) =>
      tx.insert(people).values(
        chunk.map((p) => {
          const index = planned.indexOf(p);
          return {
            id: p.id,
            personCode: codes[index]!,
            firstName: p.firstName,
            lastName: p.lastName,
            gender: p.gender,
            phoneE164: `+63900${String(index + 1).padStart(7, '0')}`,
            email: p.email,
            birthMonth: 1 + Math.floor(rand() * 12),
            birthDay: 1 + Math.floor(rand() * 28),
            joinedOn: `${2012 + Math.floor(rand() * 14)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-15`,
            source: 'import' as const,
            journalExpected: p.kind !== 'pastor',
          };
        }),
      ),
    );

    const designationFor = (p: PlannedPerson) => (p.kind === 'pastor' ? 'pastor' : p.kind === 'member' ? (rand() < 0.2 ? 'worker' : 'member') : 'worker');
    await insertChunks(planned, 1000, (chunk) =>
      tx.insert(personDesignations).values(chunk.map((p) => ({ personId: p.id, designationKey: designationFor(p) }))),
    );

    // Bulk hierarchy: nodes (parents first), then closure rows computed in memory, then verified.
    const byId = new Map(planned.map((p) => [p.id, p]));
    const ancestorsOf = (p: PlannedPerson) => {
      const chain: PlannedPerson[] = [];
      let current = p.parentId ? byId.get(p.parentId) : undefined;
      while (current) {
        chain.push(current);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return chain; // nearest first
    };
    const primaryOf = (p: PlannedPerson) => {
      if (p.depth < primaryLeaderDepth) return null;
      if (p.depth === primaryLeaderDepth) return p.id;
      return ancestorsOf(p).find((a) => a.depth === primaryLeaderDepth)?.id ?? null;
    };

    await insertChunks(planned, 500, (chunk) =>
      tx.insert(hierarchyNodes).values(
        chunk.map((p) => ({
          personId: p.id,
          parentPersonId: p.parentId,
          depth: p.depth,
          primaryLeaderPersonId: primaryOf(p),
          acceptsMembers: p.kind !== 'member',
        })),
      ),
    );
    const closure = planned.flatMap((p) => [
      { ancestorId: p.id, descendantId: p.id, depth: 0 },
      ...ancestorsOf(p).map((a, i) => ({ ancestorId: a.id, descendantId: p.id, depth: i + 1 })),
    ]);
    await insertChunks(closure, 1000, (chunk) => tx.insert(hierarchyClosure).values(chunk));
    const operationId = newId();
    await insertChunks(planned, 1000, (chunk) =>
      tx.insert(leadershipHistory).values(
        chunk.map((p) => ({ personId: p.id, newLeaderPersonId: p.parentId, changeType: 'placed' as const, operationId, reason: 'Demo data' })),
      ),
    );

    // ── Serving ───────────────────────────────────────────────────────────────
    const codesList = [...ministryIds.keys()];
    const memberships = planned
      .filter((p) => p.kind !== 'pastor' && rand() < 0.35)
      .map((p) => ({ personId: p.id, ministryId: ministryIds.get(pick(codesList))!, isPrimary: true, position: 'member' as const }));
    await insertChunks(memberships, 1000, (chunk) => tx.insert(ministryMemberships).values(chunk));
    const worshippers = memberships.filter((m) => m.ministryId === worshipId).slice(0, 30);
    await tx.insert(teamMemberships).values(worshippers.map((m, i) => ({ teamId: teamIds[i % 3]!, personId: m.personId })));

    // ── Demo portal accounts ──────────────────────────────────────────────────
    const roleRows = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.key, ['primary_leader', 'leader']));
    const roleId = (key: string) => roleRows.find((r) => r.key === key)!.id;
    const accounts: string[] = [];
    for (const [email, roleKey] of [
      [`primary.leader@${DEMO_EMAIL_DOMAIN}`, 'primary_leader'],
      [`leader@${DEMO_EMAIL_DOMAIN}`, 'leader'],
    ] as const) {
      const p = planned.find((x) => x.email === email)!;
      const userId = newId();
      await tx.insert(users).values({ id: userId, email, name: `${p.firstName} ${p.lastName}`, personId: p.id, status: 'invited' });
      await tx.insert(userRoleAssignments).values({
        userId,
        roleId: roleId(roleKey),
        scopeType: 'branch',
        scopePersonId: p.id,
        branchMaxDepth: roleKey === 'leader' ? leaderStatusDepth : null,
        grantReason: 'Demo account',
      });
      accounts.push(`${email} (${roleKey === 'leader' ? 'Leader' : 'Primary Leader'} ${p.firstName} ${p.lastName})`);
    }

    const verification = await verifyHierarchy(tx, primaryLeaderDepth);
    if (!isConsistent(verification)) throw new Error(`Demo hierarchy is inconsistent: ${JSON.stringify(verification)}`);
    const [pastorRow] = await tx.select({ id: people.id }).from(people).where(eq(people.id, pastor.id));
    if (!pastorRow) throw new Error('Demo seed failed to insert people.');

    return { created: true, people: planned.length, accounts };
  });
}
