import Papa from 'papaparse';

/**
 * Pure CSV parsing and field normalisation for the people import (no database access).
 * Column names are matched case-insensitively with common aliases, so a typical
 * church spreadsheet ("Mobile Number", "Date Joined", "Leader") works without renaming.
 */

export const IMPORT_COLUMNS = {
  ref: ['ref', 'reference', 'row_id'],
  person_code: ['person_code', 'code'],
  first_name: ['first_name', 'firstname', 'given_name'],
  last_name: ['last_name', 'lastname', 'surname', 'family_name'],
  middle_name: ['middle_name', 'middlename'],
  preferred_name: ['preferred_name', 'nickname', 'nick_name'],
  suffix: ['suffix'],
  mobile: ['mobile', 'phone', 'mobile_number', 'cellphone', 'cell_number', 'contact_number'],
  email: ['email', 'email_address'],
  birthday: ['birthday', 'birth_date', 'birthdate', 'date_of_birth'],
  gender: ['gender', 'sex'],
  joined_on: ['joined_on', 'date_joined', 'joined'],
  leader: ['leader', 'direct_leader', 'leader_ref', 'leader_code'],
  ministry: ['ministry'],
  designations: ['designations', 'designation'],
  accepts_members: ['accepts_members', 'can_lead', 'is_leader'],
} as const;

export type ImportColumn = keyof typeof IMPORT_COLUMNS;
export type RawImportRow = Partial<Record<ImportColumn, string>>;

export const REQUIRED_COLUMNS: ImportColumn[] = ['first_name', 'last_name'];

export function normalizeHeader(header: string): string {
  return header
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const ALIAS_TO_COLUMN = new Map<string, ImportColumn>(
  (Object.entries(IMPORT_COLUMNS) as [ImportColumn, readonly string[]][]).flatMap(([column, aliases]) =>
    aliases.map((alias) => [alias, column] as const),
  ),
);

export interface ParsedCsv {
  rows: RawImportRow[];
  unknownColumns: string[];
  missingRequired: ImportColumn[];
}

export function parsePeopleCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeHeader,
  });
  const headers = (result.meta.fields ?? []).filter(Boolean);
  const mapped = new Set(headers.map((h) => ALIAS_TO_COLUMN.get(h)).filter(Boolean));

  const rows = result.data.map((record) => {
    const row: RawImportRow = {};
    for (const [header, value] of Object.entries(record)) {
      const column = ALIAS_TO_COLUMN.get(header);
      if (column && typeof value === 'string' && value.trim() !== '' && row[column] === undefined) {
        row[column] = value.replace(/\s+/g, ' ').trim();
      }
    }
    return row;
  });

  return {
    rows,
    unknownColumns: headers.filter((h) => !ALIAS_TO_COLUMN.has(h)),
    missingRequired: REQUIRED_COLUMNS.filter((c) => !mapped.has(c)),
  };
}

export interface PartialDate {
  year: number | null;
  month: number;
  day: number;
}

function validDate(year: number | null, month: number, day: number): PartialDate | null {
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year ?? 2024, month, 0)).getUTCDate()) return null;
  if (year !== null && (year < 1900 || year > new Date().getFullYear())) return null;
  return { year, month, day };
}

/**
 * Accepts ISO (1990-03-14), MM/DD/YYYY (the Philippine convention), MM/DD/YY, MM/DD
 * (birthday without year) and written dates ("March 14, 1990").
 */
export function parseFlexibleDate(raw: string): PartialDate | null {
  const value = raw.trim();
  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/);
  if (m) {
    let year = Number(m[3]);
    if (m[3]!.length === 2) year += year > new Date().getFullYear() % 100 ? 1900 : 2000;
    return validDate(year, Number(m[1]), Number(m[2]));
  }

  m = value.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m) return validDate(null, Number(m[1]), Number(m[2]));

  if (/[a-z]/i.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return validDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return null;
}

export function parseGender(raw: string): 'male' | 'female' | null {
  if (/^(m|male|lalaki)$/i.test(raw.trim())) return 'male';
  if (/^(f|female|babae)$/i.test(raw.trim())) return 'female';
  return null;
}

export function parseYesNo(raw: string | undefined): boolean {
  return raw !== undefined && /^(y|yes|true|1|x|✓)$/i.test(raw.trim());
}

/** Lower-case, accent-free, single-spaced — for matching names typed in different ways. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const PEOPLE_IMPORT_TEMPLATE = [
  'ref,first_name,last_name,preferred_name,mobile,email,birthday,gender,joined_on,leader,ministry,designations,accepts_members',
  'PASTOR,Eduardo,Villanueva,Ed,0917 000 0001,pastor@example.org,03/14/1970,male,01/05/2010,,,pastor,yes',
  'MICHAEL,Michael,Reyes,,0917 000 0002,,,male,,PASTOR,,worker,yes',
  ',John,Cruz,,0917 000 0003,,07/21,male,,MICHAEL,,member,no',
].join('\r\n');
