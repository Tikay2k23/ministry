import { eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { formFields, forms, formVersions } from '../../db/schema';

/**
 * The default prayer report form (docs/05 W10 step 3, W12 step 6): an optional report, a
 * testimony, and a prayer request only the pastoral team can read. Participants may share it
 * anonymously. It is created by the reference-data seed, and on first use in databases seeded
 * before it existed; ministries can adapt it later through the forms engine.
 */

export const PRAYER_REPORT_FORM_KEY = 'prayer_report';

const FIELDS = [
  {
    fieldKey: 'report',
    fieldType: 'long_text',
    label: 'How was your time of prayer?',
    helpText: 'Anything you sensed, or how you prayed.',
    isRequired: false,
    sensitivity: 'standard',
  },
  {
    fieldKey: 'testimony',
    fieldType: 'testimony',
    label: 'Is there a testimony you would like to share?',
    helpText: null,
    isRequired: false,
    sensitivity: 'standard',
  },
  {
    fieldKey: 'prayer_request',
    fieldType: 'prayer_request',
    label: 'Is there anything you would like prayer for?',
    helpText: 'Read only by the pastoral team.',
    isRequired: false,
    sensitivity: 'confidential',
  },
] satisfies Omit<typeof formFields.$inferInsert, 'formVersionId' | 'sortOrder'>[];

/** The prayer report form's id, creating the form and its first published version when missing. */
export async function ensurePrayerReportForm(executor: Executor): Promise<string> {
  const find = async () => (await executor.select({ id: forms.id }).from(forms).where(eq(forms.key, PRAYER_REPORT_FORM_KEY)))[0]?.id;
  const existing = await find();
  if (existing) return existing;

  const [form] = await executor
    .insert(forms)
    .values({
      key: PRAYER_REPORT_FORM_KEY,
      name: 'Prayer report',
      purpose: 'prayer_report',
      description: 'Shared after a prayer slot: a report, a testimony or a prayer request.',
    })
    .onConflictDoNothing()
    .returning({ id: forms.id });
  if (!form) return (await find())!; // created by a concurrent request

  const [version] = await executor
    .insert(formVersions)
    .values({ formId: form.id, versionNo: 1, status: 'published', publishedAt: new Date() })
    .returning({ id: formVersions.id });
  await executor.insert(formFields).values(FIELDS.map((field, i) => ({ ...field, formVersionId: version!.id, sortOrder: i })));
  return form.id;
}
