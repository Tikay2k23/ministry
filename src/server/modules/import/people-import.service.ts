import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeCode } from '@/lib/ids';
import { looksLikePhone, normalizePhone } from '@/lib/phone';
import { actorUserId, type RequestContext } from '../../context/request-context';
import { queryRows, type Database, type Executor } from '../../db/client';
import { IMPORT_ROW_OUTCOMES } from '../../db/enums';
import {
  designationTypes,
  hierarchyNodes,
  importJobs,
  importRows,
  ministries,
  ministryMemberships,
  people,
  personDesignations,
  users,
} from '../../db/schema';
import { conflict, invalidState, isAppError, notFound, validationError } from '../../errors';
import { assertGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { insertNode, lockHierarchy, writeHistory, type HistoryRow } from '../hierarchy/hierarchy.core';
import { findDuplicateMatches, recordDuplicateCandidates } from '../people/dedupe';
import { generatePersonCodes } from '../people/person-codes';
import { getSetting } from '../settings/settings.service';
import {
  normalizeName,
  parseFlexibleDate,
  parseGender,
  parsePeopleCsv,
  parseYesNo,
  type RawImportRow,
} from './people-import.parse';

/**
 * People + leadership import (docs/01 FR-PPL-10, docs/04 A7). Two steps:
 * 1. preview — validate every row, resolve leaders, detect duplicates and cycles; nothing is created.
 * 2. commit  — create people and place them in the tree in one transaction (all or nothing).
 * Rows with errors are never imported and nothing is guessed. Runs synchronously for now;
 * moves to the background worker when it arrives (M2).
 */

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;

type Message = { level: 'error' | 'warning'; field?: string; message: string };
type LeaderTarget = { kind: 'row'; rowNo: number; name: string } | { kind: 'person'; personId: string; name: string };

export interface ImportRowData {
  ref: string | null;
  personCode: string | null;
  firstName: string;
  lastName: string;
  middleName: string | null;
  preferredName: string | null;
  suffix: string | null;
  phoneE164: string | null;
  email: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  gender: 'male' | 'female' | null;
  joinedOn: string | null;
  designations: string[];
  acceptsMembers: boolean;
  leaderRaw: string | null;
  leader: LeaderTarget | null;
  ministryId: string | null;
  ministryName: string | null;
  placement: 'under_leader' | 'root' | 'unplaced';
  /** Set when the row refers to someone already in the directory (person code or strong duplicate). */
  existingPersonId: string | null;
  existingPersonName: string | null;
  /** People who share this row's mobile number (review queue after import). */
  sharesPhoneWith: string[];
}

interface WorkingRow {
  rowNo: number;
  raw: RawImportRow;
  data: ImportRowData;
  messages: Message[];
}

const hasErrors = (row: WorkingRow) => row.messages.some((m) => m.level === 'error');
const creatable = (row: WorkingRow) => !hasErrors(row) && row.data.existingPersonId === null;
const fullName = (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName}`;

function validateFields(
  raw: RawImportRow,
  rowNo: number,
  lookups: { defaultCountry: string; designations: Map<string, string>; ministries: Map<string, { id: string; name: string }> },
): WorkingRow {
  const messages: Message[] = [];
  const name = (value: string | undefined, field: string, label: string, required: boolean) => {
    if (!value) {
      if (required) messages.push({ level: 'error', field, message: `${label} is required.` });
      return null;
    }
    if (value.length > 80) messages.push({ level: 'error', field, message: `${label} is longer than 80 characters.` });
    return value;
  };

  const data: ImportRowData = {
    ref: raw.ref ?? null,
    personCode: raw.person_code ? `P-${normalizeCode(raw.person_code).replace(/^P/, '')}` : null,
    firstName: name(raw.first_name, 'first_name', 'First name', true) ?? '',
    lastName: name(raw.last_name, 'last_name', 'Last name', true) ?? '',
    middleName: name(raw.middle_name, 'middle_name', 'Middle name', false),
    preferredName: name(raw.preferred_name, 'preferred_name', 'Preferred name', false),
    suffix: raw.suffix ? raw.suffix.slice(0, 20) : null,
    phoneE164: null,
    email: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    gender: null,
    joinedOn: null,
    designations: [],
    acceptsMembers: parseYesNo(raw.accepts_members),
    leaderRaw: raw.leader ?? null,
    leader: null,
    ministryId: null,
    ministryName: null,
    placement: 'unplaced',
    existingPersonId: null,
    existingPersonName: null,
    sharesPhoneWith: [],
  };

  if (raw.mobile) {
    const phone = normalizePhone(raw.mobile, lookups.defaultCountry);
    if (phone.ok) data.phoneE164 = phone.e164;
    else messages.push({ level: 'warning', field: 'mobile', message: `“${raw.mobile}” isn’t a valid mobile number — it will be left blank.` });
  }
  if (raw.email) {
    if (z.email().safeParse(raw.email).success) data.email = raw.email.toLowerCase();
    else messages.push({ level: 'warning', field: 'email', message: `“${raw.email}” isn’t a valid email — it will be left blank.` });
  }
  if (raw.birthday) {
    const d = parseFlexibleDate(raw.birthday);
    if (d) Object.assign(data, { birthMonth: d.month, birthDay: d.day, birthYear: d.year });
    else messages.push({ level: 'warning', field: 'birthday', message: `Couldn’t read the birthday “${raw.birthday}” — use MM/DD/YYYY.` });
  }
  if (raw.gender) {
    data.gender = parseGender(raw.gender);
    if (!data.gender) messages.push({ level: 'warning', field: 'gender', message: `Unknown gender “${raw.gender}” — it will be left blank.` });
  }
  if (raw.joined_on) {
    const d = parseFlexibleDate(raw.joined_on);
    if (d?.year) data.joinedOn = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    else messages.push({ level: 'warning', field: 'joined_on', message: `Couldn’t read the date joined “${raw.joined_on}” — use MM/DD/YYYY.` });
  }
  if (raw.designations) {
    for (const part of raw.designations.split(/[;,|/]/).map((p) => p.trim()).filter(Boolean)) {
      const key = lookups.designations.get(part.toLowerCase());
      if (key) {
        if (!data.designations.includes(key)) data.designations.push(key);
      } else {
        messages.push({ level: 'warning', field: 'designations', message: `Unknown designation “${part}” — ignored.` });
      }
    }
  }
  if (raw.ministry) {
    const ministry = lookups.ministries.get(raw.ministry.toLowerCase());
    if (ministry) Object.assign(data, { ministryId: ministry.id, ministryName: ministry.name });
    else messages.push({ level: 'warning', field: 'ministry', message: `Ministry “${raw.ministry}” was not found — skipped.` });
  }

  return { rowNo, raw, data, messages };
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export async function previewPeopleImport(db: Database, ctx: RequestContext, input: { fileName: string; text: string }) {
  assertGlobal(ctx, 'import.manage');
  if (Buffer.byteLength(input.text, 'utf8') > MAX_IMPORT_BYTES) throw validationError({ file: ['The file is larger than 5 MB.'] });

  const parsed = parsePeopleCsv(input.text);
  if (parsed.missingRequired.length > 0) {
    throw validationError({
      file: [`Missing required column(s): ${parsed.missingRequired.join(', ')}. Download the template to see the expected columns.`],
    });
  }
  if (parsed.rows.length === 0) throw validationError({ file: ['The file has no rows.'] });
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw validationError({ file: [`The file has ${parsed.rows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`] });
  }

  const { defaultCountry } = await getSetting(db, 'ministry.profile');
  const designationLookup = new Map<string, string>();
  for (const d of await db.select().from(designationTypes)) {
    designationLookup.set(d.key.toLowerCase(), d.key);
    designationLookup.set(d.name.toLowerCase(), d.key);
  }
  const ministryLookup = new Map<string, { id: string; name: string }>();
  for (const m of await db.select().from(ministries).where(isNull(ministries.archivedAt))) {
    ministryLookup.set(m.name.toLowerCase(), { id: m.id, name: m.name });
    ministryLookup.set(m.code.toLowerCase(), { id: m.id, name: m.name });
  }

  // Spreadsheet row numbers: the header is row 1.
  const rows = parsed.rows.map((raw, i) =>
    validateFields(raw, i + 2, { defaultCountry, designations: designationLookup, ministries: ministryLookup }),
  );
  const byRowNo = new Map(rows.map((r) => [r.rowNo, r]));

  // 1. References that must be unique within the file.
  const refs = new Map<string, number>();
  for (const row of rows) {
    if (!row.data.ref) continue;
    const key = row.data.ref.toLowerCase();
    if (refs.has(key)) row.messages.push({ level: 'error', field: 'ref', message: `Ref “${row.data.ref}” is also used on row ${refs.get(key)}.` });
    else refs.set(key, row.rowNo);
  }

  // 2. Rows that name an existing person by person code.
  const codes = [...new Set(rows.map((r) => r.data.personCode).filter((c): c is string => Boolean(c)))];
  const existingByCode = new Map(
    (codes.length
      ? await db.select({ id: people.id, code: people.personCode, firstName: people.firstName, lastName: people.lastName }).from(people).where(and(inArray(people.personCode, codes), isNull(people.archivedAt)))
      : []
    ).map((p) => [p.code, p]),
  );
  for (const row of rows) {
    if (!row.data.personCode) continue;
    const existing = existingByCode.get(row.data.personCode);
    if (!existing) {
      row.messages.push({ level: 'error', field: 'person_code', message: `No one in the directory has person code ${row.data.personCode}.` });
    } else {
      row.data.existingPersonId = existing.id;
      row.data.existingPersonName = fullName(existing);
    }
  }

  // 3. Duplicates within the file (same mobile + first name, or same email).
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (hasErrors(row) || row.data.existingPersonId) continue;
    const keys = [
      row.data.phoneE164 ? `p:${row.data.phoneE164}:${normalizeName(row.data.firstName)}` : null,
      row.data.email ? `e:${row.data.email}` : null,
    ].filter((k): k is string => Boolean(k));
    const earlier = keys.map((k) => seen.get(k)).find((n) => n !== undefined);
    if (earlier !== undefined) {
      row.messages.push({ level: 'error', message: `Looks like the same person as row ${earlier}.` });
    } else {
      for (const k of keys) seen.set(k, row.rowNo);
    }
  }

  // 4. Duplicates against the directory.
  for (const row of rows) {
    if (hasErrors(row) || row.data.existingPersonId) continue;
    const matches = await findDuplicateMatches(db, row.data);
    const strong = matches.find((m) => m.strength === 'strong');
    if (strong) {
      row.data.existingPersonId = strong.personId;
      row.data.existingPersonName = `${strong.firstName} ${strong.lastName}`;
      row.messages.push({
        level: 'warning',
        message: `Already in the directory as ${strong.firstName} ${strong.lastName} (${strong.personCode}) — not imported again.`,
      });
      continue;
    }
    const sharedPhone = matches.filter((m) => m.strength === 'medium');
    if (sharedPhone.length > 0) {
      row.data.sharesPhoneWith = sharedPhone.map((m) => m.personId);
      row.messages.push({
        level: 'warning',
        field: 'mobile',
        message: `Shares a mobile number with ${sharedPhone.map((m) => `${m.firstName} ${m.lastName}`).join(', ')} — added to the duplicates review.`,
      });
    }
  }

  // 5. Leader resolution: ref in file → person code → mobile → email → exact name.
  const fileIndex = (key: (d: ImportRowData) => string | null) => {
    const index = new Map<string, number[]>();
    for (const row of rows) {
      const k = key(row.data);
      if (k) index.set(k, [...(index.get(k) ?? []), row.rowNo]);
    }
    return index;
  };
  const fileByCode = fileIndex((d) => d.personCode);
  const fileByPhone = fileIndex((d) => d.phoneE164);
  const fileByEmail = fileIndex((d) => d.email);
  const fileByName = fileIndex((d) => (d.firstName ? normalizeName(fullName(d)) : null));

  type Resolution = { target: LeaderTarget } | { error: string };
  const fromRows = (rowNos: number[] | undefined, label: string): Resolution | null => {
    if (!rowNos || rowNos.length === 0) return null;
    if (rowNos.length > 1) return { error: `Leader “${label}” matches rows ${rowNos.join(', ')} — use a ref or person code.` };
    const target = byRowNo.get(rowNos[0]!)!;
    return target.data.existingPersonId
      ? { target: { kind: 'person', personId: target.data.existingPersonId, name: target.data.existingPersonName! } }
      : { target: { kind: 'row', rowNo: target.rowNo, name: fullName(target.data) } };
  };
  const fromPeople = (found: { id: string; firstName: string; lastName: string }[], label: string): Resolution => {
    if (found.length === 1) return { target: { kind: 'person', personId: found[0]!.id, name: fullName(found[0]!) } };
    if (found.length > 1) return { error: `Leader “${label}” matches ${found.length} people in the directory — use their person code.` };
    return { error: `Leader “${label}” was not found in this file or the directory.` };
  };
  const personColumns = { id: people.id, firstName: people.firstName, lastName: people.lastName };

  const cache = new Map<string, Resolution>();
  async function resolveLeader(label: string): Promise<Resolution> {
    const cached = cache.get(label);
    if (cached) return cached;
    let resolution: Resolution;
    const refRow = refs.get(label.toLowerCase());
    if (refRow !== undefined) {
      resolution = fromRows([refRow], label)!;
    } else if (/^P-?[0-9A-Za-z]{6}$/.test(label)) {
      const code = `P-${normalizeCode(label).slice(1)}`;
      resolution =
        fromRows(fileByCode.get(code), label) ??
        fromPeople(await db.select(personColumns).from(people).where(and(eq(people.personCode, code), isNull(people.archivedAt))), label);
    } else if (looksLikePhone(label)) {
      const phone = normalizePhone(label, defaultCountry);
      resolution = !phone.ok
        ? { error: `Leader “${label}” isn’t a valid mobile number.` }
        : (fromRows(fileByPhone.get(phone.e164), label) ??
          fromPeople(await db.select(personColumns).from(people).where(and(eq(people.phoneE164, phone.e164), isNull(people.archivedAt))), label));
    } else if (label.includes('@')) {
      const email = label.toLowerCase();
      resolution =
        fromRows(fileByEmail.get(email), label) ??
        fromPeople(await db.select(personColumns).from(people).where(and(eq(people.email, email), isNull(people.archivedAt))), label);
    } else {
      resolution =
        fromRows(fileByName.get(normalizeName(label)), label) ??
        fromPeople(
          await db
            .select(personColumns)
            .from(people)
            .where(and(isNull(people.archivedAt), sql`lower(immutable_unaccent(${people.firstName} || ' ' || ${people.lastName})) = lower(immutable_unaccent(${label.replace(/\s+/g, ' ')}))`))
            .limit(5),
          label,
        );
    }
    cache.set(label, resolution);
    return resolution;
  }

  for (const row of rows) {
    if (!row.data.leaderRaw || hasErrors(row)) continue;
    if (row.data.existingPersonId) {
      row.messages.push({ level: 'warning', field: 'leader', message: 'Already in the directory, so the leader in this file is ignored.' });
      continue;
    }
    const resolution = await resolveLeader(row.data.leaderRaw);
    if ('error' in resolution) row.messages.push({ level: 'error', field: 'leader', message: resolution.error });
    else if (resolution.target.kind === 'row' && resolution.target.rowNo === row.rowNo) {
      row.messages.push({ level: 'error', field: 'leader', message: 'A person can’t be their own leader.' });
    } else row.data.leader = resolution.target;
  }

  // Existing leaders must already be in the leadership structure.
  const existingLeaderIds = [...new Set(rows.flatMap((r) => (r.data.leader?.kind === 'person' ? [r.data.leader.personId] : [])))];
  const placedLeaders = new Set(
    existingLeaderIds.length
      ? (await db.select({ id: hierarchyNodes.personId }).from(hierarchyNodes).where(inArray(hierarchyNodes.personId, existingLeaderIds))).map((n) => n.id)
      : [],
  );
  for (const row of rows) {
    const leader = row.data.leader;
    if (leader?.kind === 'person' && !placedLeaders.has(leader.personId)) {
      row.messages.push({ level: 'error', field: 'leader', message: `${leader.name} is not in the leadership structure yet.` });
    }
  }

  // 6. Circular leadership within the file.
  for (const row of rows) {
    if (hasErrors(row)) continue;
    const path: number[] = [];
    let current: WorkingRow | undefined = row;
    while (current?.data.leader?.kind === 'row') {
      if (path.includes(current.rowNo)) {
        const cycle = path.slice(path.indexOf(current.rowNo));
        for (const n of cycle) {
          const r = byRowNo.get(n)!;
          if (!hasErrors(r)) r.messages.push({ level: 'error', field: 'leader', message: `Circular leadership: rows ${[...cycle, cycle[0]].join(' → ')}.` });
        }
        break;
      }
      path.push(current.rowNo);
      current = byRowNo.get(current.data.leader.rowNo);
    }
  }

  // 7. A row can only be imported when its leader row can.
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const leader = row.data.leader;
      if (hasErrors(row) || leader?.kind !== 'row') continue;
      const target = byRowNo.get(leader.rowNo)!;
      if (hasErrors(target)) {
        row.messages.push({ level: 'error', field: 'leader', message: `Its leader (row ${target.rowNo}) can’t be imported.` });
        changed = true;
      }
    }
  }

  // 8. Placement: under the leader; roots when others follow them; otherwise not placed.
  const referencedRows = new Set(rows.filter(creatable).flatMap((r) => (r.data.leader?.kind === 'row' ? [r.data.leader.rowNo] : [])));
  for (const row of rows) {
    if (!creatable(row)) continue;
    if (row.data.leader) row.data.placement = 'under_leader';
    else if (referencedRows.has(row.rowNo)) row.data.placement = 'root';
    else {
      row.data.placement = 'unplaced';
      row.messages.push({ level: 'warning', field: 'leader', message: 'No leader given — this person won’t be placed in the leadership structure.' });
    }
  }

  // 9. Outcomes and summary.
  const outcomeOf = (row: WorkingRow): (typeof IMPORT_ROW_OUTCOMES)[number] =>
    hasErrors(row)
      ? 'error'
      : row.data.existingPersonId
        ? row.data.personCode
          ? 'skipped'
          : 'duplicate_candidate'
        : row.messages.length > 0
          ? 'warning'
          : 'valid';
  const outcomes = rows.map(outcomeOf);
  const stats = {
    total: rows.length,
    valid: outcomes.filter((o) => o === 'valid').length,
    warning: outcomes.filter((o) => o === 'warning').length,
    error: outcomes.filter((o) => o === 'error').length,
    duplicate: outcomes.filter((o) => o === 'duplicate_candidate').length,
    skipped: outcomes.filter((o) => o === 'skipped').length,
    willCreate: rows.filter(creatable).length,
    roots: rows.filter((r) => creatable(r) && r.data.placement === 'root').length,
    unplaced: rows.filter((r) => creatable(r) && r.data.placement === 'unplaced').length,
    unknownColumns: parsed.unknownColumns,
  };

  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        kind: 'people_hierarchy',
        status: 'previewed',
        fileName: input.fileName.slice(0, 200),
        options: { defaultCountry },
        stats,
        createdBy: actorUserId(ctx)!,
      })
      .returning({ id: importJobs.id });
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(importRows).values(
        rows.slice(i, i + 500).map((row, j) => ({
          importJobId: job!.id,
          rowNo: row.rowNo,
          raw: row.raw,
          normalized: row.data,
          outcome: outcomes[i + j]!,
          messages: row.messages,
          matchedPersonId: row.data.existingPersonId,
        })),
      );
    }
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'import.previewed',
      entityType: 'import_job',
      entityId: job!.id,
      newValues: { fileName: input.fileName, total: stats.total, willCreate: stats.willCreate, errors: stats.error },
    });
    return { jobId: job!.id, stats };
  });
}

// ─── Commit ───────────────────────────────────────────────────────────────────

export async function commitPeopleImport(db: Database, ctx: RequestContext, raw: unknown) {
  const { jobId } = parseInput(z.object({ jobId: z.uuid() }), raw);
  assertGlobal(ctx, 'import.manage');

  try {
    return await db.transaction(async (tx) => {
      const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).for('update');
      if (!job) throw notFound('import');
      if (job.status !== 'previewed') throw invalidState('This import has already been committed or cancelled.');

      const rows = await tx
        .select({ rowNo: importRows.rowNo, normalized: importRows.normalized })
        .from(importRows)
        .where(and(eq(importRows.importJobId, jobId), inArray(importRows.outcome, ['valid', 'warning'])))
        .orderBy(asc(importRows.rowNo));
      const data = new Map(rows.map((r) => [r.rowNo, r.normalized as ImportRowData]));

      // Leaders outside the file must still be in the tree (the directory may have changed).
      const externalLeaders = [...new Set([...data.values()].flatMap((d) => (d.leader?.kind === 'person' ? [d.leader.personId] : [])))];
      if (externalLeaders.length) {
        const placed = await tx.select({ id: hierarchyNodes.personId }).from(hierarchyNodes).where(inArray(hierarchyNodes.personId, externalLeaders));
        if (placed.length !== externalLeaders.length) {
          throw conflict('The leadership structure changed since the preview. Please upload the file again.');
        }
      }

      // Leaders are created before the people they lead.
      const depthCache = new Map<number, number>();
      const depthOf = (rowNo: number): number => {
        const cached = depthCache.get(rowNo);
        if (cached !== undefined) return cached;
        const leader = data.get(rowNo)?.leader;
        const depth = leader?.kind === 'row' ? depthOf(leader.rowNo) + 1 : 0;
        depthCache.set(rowNo, depth);
        return depth;
      };
      const order = [...data.keys()].sort((a, b) => depthOf(a) - depthOf(b) || a - b);

      const codes = await generatePersonCodes(tx, order.length);
      await lockHierarchy(tx);
      const { primaryLeaderDepth } = await getSetting(tx, 'hierarchy');
      const today = ctx.now.toISOString().slice(0, 10);
      const created = new Map<number, string>();
      const history: HistoryRow[] = [];

      for (const [index, rowNo] of order.entries()) {
        const d = data.get(rowNo)!;
        const [person] = await tx
          .insert(people)
          .values({
            personCode: codes[index]!,
            firstName: d.firstName,
            lastName: d.lastName,
            middleName: d.middleName,
            preferredName: d.preferredName,
            suffix: d.suffix,
            gender: d.gender,
            birthMonth: d.birthMonth,
            birthDay: d.birthDay,
            birthYear: d.birthYear,
            phoneE164: d.phoneE164,
            email: d.email,
            joinedOn: d.joinedOn,
            source: 'import',
            createdBy: actorUserId(ctx),
            updatedBy: actorUserId(ctx),
          })
          .returning({ id: people.id });
        created.set(rowNo, person!.id);

        if (d.designations.length) {
          await tx.insert(personDesignations).values(d.designations.map((designationKey) => ({ personId: person!.id, designationKey, startedOn: today })));
        }
        if (d.ministryId) {
          await tx.insert(ministryMemberships).values({ personId: person!.id, ministryId: d.ministryId, isPrimary: true, startedOn: today });
        }
        if (d.placement !== 'unplaced') {
          const parent =
            d.placement === 'root' ? null : d.leader!.kind === 'row' ? created.get(d.leader!.rowNo)! : d.leader!.personId;
          await insertNode(tx, { personId: person!.id, parentPersonId: parent, primaryLeaderDepth, acceptsMembers: d.acceptsMembers });
          history.push({ personId: person!.id, previousLeaderPersonId: null, newLeaderPersonId: parent, changeType: 'placed' });
        }
        if (d.sharesPhoneWith.length) {
          await recordDuplicateCandidates(
            tx,
            person!.id,
            d.sharesPhoneWith.map((personId) => ({ personId, personCode: '', firstName: '', lastName: '', reasons: ['same_phone'], strength: 'medium', score: 0.7 })),
          );
        }
        await tx.update(importRows).set({ outcome: 'imported', createdPersonId: person!.id }).where(and(eq(importRows.importJobId, jobId), eq(importRows.rowNo, rowNo)));
      }

      for (let i = 0; i < history.length; i += 500) {
        await writeHistory(tx, history.slice(i, i + 500), { operationId: jobId, changedBy: actorUserId(ctx), reason: `Import: ${job.fileName}`, at: ctx.now });
      }
      const stats = { ...(job.stats as Record<string, unknown>), imported: order.length, placed: history.length };
      await tx.update(importJobs).set({ status: 'completed', completedAt: ctx.now, stats }).where(eq(importJobs.id, jobId));
      await recordAudit(tx, ctx, {
        category: 'change',
        action: 'import.committed',
        entityType: 'import_job',
        entityId: jobId,
        newValues: { fileName: job.fileName, imported: order.length, placed: history.length },
      });
      return { imported: order.length, placed: history.length };
    });
  } catch (error) {
    if (!isAppError(error)) {
      await db.update(importJobs).set({ status: 'failed', completedAt: new Date() }).where(and(eq(importJobs.id, jobId), eq(importJobs.status, 'previewed')));
    }
    throw error;
  }
}

export async function cancelPeopleImport(db: Database, ctx: RequestContext, raw: unknown) {
  const { jobId } = parseInput(z.object({ jobId: z.uuid() }), raw);
  assertGlobal(ctx, 'import.manage');
  const [row] = await db
    .update(importJobs)
    .set({ status: 'cancelled', completedAt: ctx.now })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, 'previewed')))
    .returning({ id: importJobs.id });
  if (!row) throw invalidState('Only an import that hasn’t been committed can be cancelled.');
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listImportJobs(db: Executor, ctx: RequestContext) {
  assertGlobal(ctx, 'import.manage');
  return db
    .select({
      id: importJobs.id,
      fileName: importJobs.fileName,
      status: importJobs.status,
      stats: importJobs.stats,
      createdAt: importJobs.createdAt,
      completedAt: importJobs.completedAt,
      createdByName: users.name,
    })
    .from(importJobs)
    .leftJoin(users, eq(users.id, importJobs.createdBy))
    .orderBy(desc(importJobs.createdAt))
    .limit(10);
}

export const IMPORT_PAGE_SIZE = 50;

export async function getImportJob(
  db: Executor,
  ctx: RequestContext,
  jobId: string,
  options: { outcome?: (typeof IMPORT_ROW_OUTCOMES)[number]; page?: number } = {},
) {
  assertGlobal(ctx, 'import.manage');
  if (!z.uuid().safeParse(jobId).success) throw notFound('import');
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  if (!job) throw notFound('import');

  const page = Math.max(1, options.page ?? 1);
  const where = and(eq(importRows.importJobId, jobId), options.outcome ? eq(importRows.outcome, options.outcome) : undefined);
  const [rows, [totalRow], outcomeCounts] = await Promise.all([
    db
      .select()
      .from(importRows)
      .where(where)
      .orderBy(asc(importRows.rowNo))
      .limit(IMPORT_PAGE_SIZE)
      .offset((page - 1) * IMPORT_PAGE_SIZE),
    db.select({ total: count() }).from(importRows).where(where),
    queryRows<{ outcome: string; n: number }>(
      db,
      sql`SELECT outcome, count(*)::int AS n FROM import_rows WHERE import_job_id = ${jobId} GROUP BY outcome`,
    ),
  ]);

  return {
    job: { id: job.id, fileName: job.fileName, status: job.status, stats: job.stats as Record<string, unknown>, createdAt: job.createdAt, completedAt: job.completedAt },
    outcomeCounts: Object.fromEntries(outcomeCounts.map((o) => [o.outcome, Number(o.n)])) as Record<string, number>,
    rows: rows.map((r) => {
      const d = r.normalized as ImportRowData | null;
      const rawRow = r.raw as RawImportRow;
      return {
        rowNo: r.rowNo,
        name: d?.firstName ? fullName(d) : [rawRow.first_name, rawRow.last_name].filter(Boolean).join(' ') || '(no name)',
        leader: d?.leader ? (d.leader.kind === 'row' ? `${d.leader.name} (row ${d.leader.rowNo})` : d.leader.name) : null,
        placement: d?.placement ?? null,
        outcome: r.outcome,
        messages: r.messages as Message[],
        createdPersonId: r.createdPersonId,
        matchedPersonId: r.matchedPersonId,
      };
    }),
    total: totalRow?.total ?? 0,
    page,
    pageSize: IMPORT_PAGE_SIZE,
  };
}
