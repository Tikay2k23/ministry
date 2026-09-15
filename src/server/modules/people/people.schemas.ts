import { z } from 'zod';
import { ARCHIVE_REASONS, GENDERS, PERSON_STATUSES } from '../../db/enums';

/** Empty form values ('' or whitespace) mean "no value". */
const emptyToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

const nullableText = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable());

const nullableInt = (min: number, max: number, message: string) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : typeof v === 'string' ? Number(v) : v),
    z.int(message).min(min, message).max(max, message).nullable(),
  );

export const personFields = {
  firstName: z.string().trim().min(1, 'Enter a first name').max(80),
  lastName: z.string().trim().min(1, 'Enter a last name').max(80),
  middleName: nullableText(80).optional(),
  suffix: nullableText(20).optional(),
  preferredName: nullableText(80).optional(),
  gender: z.preprocess(emptyToNull, z.enum(GENDERS).nullable()).optional(),
  birthMonth: nullableInt(1, 12, 'Choose a month').optional(),
  birthDay: nullableInt(1, 31, 'Enter a day between 1 and 31').optional(),
  birthYear: nullableInt(1900, new Date().getFullYear(), 'Enter a valid year').optional(),
  /** Normalised to E.164 by the service (needs the ministry's default country). */
  phone: nullableText(40).optional(),
  email: z.preprocess(emptyToNull, z.email('Enter a valid email address').toLowerCase().nullable()).optional(),
  addressLine: nullableText(200).optional(),
  city: nullableText(100).optional(),
  province: nullableText(100).optional(),
  joinedOn: z.preprocess(emptyToNull, z.iso.date('Enter a valid date').nullable()).optional(),
  journalExpected: z.boolean().optional(),
  designations: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
};

function daysInMonth(month: number, year: number | null | undefined): number {
  return new Date(Date.UTC(year ?? 2024, month, 0)).getUTCDate(); // 2024 = leap year when year unknown
}

const birthdayRefinement = (
  v: { birthMonth?: number | null; birthDay?: number | null; birthYear?: number | null },
  ctx: z.RefinementCtx,
) => {
  if (v.birthDay && !v.birthMonth) ctx.addIssue({ code: 'custom', path: ['birthMonth'], message: 'Choose a month' });
  if (v.birthMonth && v.birthDay && v.birthDay > daysInMonth(v.birthMonth, v.birthYear)) {
    ctx.addIssue({ code: 'custom', path: ['birthDay'], message: 'That day does not exist in this month' });
  }
};

export const CreatePersonInput = z
  .object({
    ...personFields,
    leaderId: z.preprocess(emptyToNull, z.uuid().nullable()).optional(),
    acceptsMembers: z.boolean().optional(),
    /** Set after the user reviewed possible duplicates and confirmed this is someone new. */
    confirmNotDuplicate: z.boolean().optional(),
  })
  .superRefine(birthdayRefinement);

export const UpdatePersonInput = z
  .object({
    personId: z.uuid(),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    ...personFields,
    firstName: personFields.firstName.optional(),
    lastName: personFields.lastName.optional(),
    status: z.enum(PERSON_STATUSES).optional(),
  })
  .superRefine(birthdayRefinement);

export const ArchivePersonInput = z.object({
  personId: z.uuid(),
  reason: z.enum(ARCHIVE_REASONS).exclude(['duplicate', 'anonymised']),
  note: z.string().trim().max(500).optional(),
});

export const PeopleFilters = z.object({
  q: z.string().trim().max(100).optional(),
  leaderId: z.uuid().optional(),
  primaryLeaderId: z.uuid().optional(),
  ministryId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  depth: z.coerce.number().int().min(0).max(50).optional(),
  status: z.enum(PERSON_STATUSES).optional(),
  designation: z.string().trim().max(40).optional(),
  registration: z.enum(['unconfirmed', 'confirmed', 'rejected']).optional(),
  placement: z.enum(['placed', 'unplaced']).optional(),
  archived: z.coerce.boolean().default(false),
  sort: z.enum(['name', 'joined', 'updated']).default('name'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100].includes(n), 'Page size must be 25, 50 or 100')
    .default(25),
});

export type PeopleFiltersInput = z.input<typeof PeopleFilters>;
