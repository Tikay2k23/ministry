import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomCode } from '@/lib/ids';
import type { Database, Transaction } from '../client';
import {
  designationTypes,
  entryCodes,
  formFields,
  forms,
  formVersions,
  leadershipLevels,
  permissions,
  privacyNoticeVersions,
  rolePermissions,
  roles,
  systemSettings,
} from '../schema';
import { ensurePrayerReportForm } from '../../modules/prayer/report-form';
import { SETTINGS } from '../../modules/settings/definitions';
import { bundleEntryDepthCap, bundleEntryKey, PERMISSIONS, ROLES } from '../../policy/catalog';

export const INITIAL_PRIVACY_NOTICE_VERSION = '2026-09-01-draft';

const LEADERSHIP_LEVELS = [
  { depth: 0, name: 'Senior Leadership', pluralName: 'Senior Leadership' },
  { depth: 1, name: 'Primary Leader', pluralName: 'Primary Leaders' },
  { depth: 2, name: 'Leader', pluralName: 'Leaders' },
  { depth: 3, name: 'Member', pluralName: 'Members' },
];

const DESIGNATIONS = [
  { key: 'member', name: 'Member', sortOrder: 1 },
  { key: 'worker', name: 'Worker', sortOrder: 2 },
  { key: 'pastor', name: 'Pastor', sortOrder: 3 },
  { key: 'staff', name: 'Ministry Staff', sortOrder: 4 },
];

/**
 * Idempotent reference data: permission catalog, system roles and their bundles, leadership
 * level names, designation types, default settings and the initial privacy notice.
 * Safe to run on every deploy: system role bundles are re-synchronised from code;
 * admin-edited settings and level names are never overwritten.
 */
export async function seedReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // Permission catalog (code is the source of truth).
    for (const [key, def] of Object.entries(PERMISSIONS)) {
      const values = {
        module: def.module,
        description: def.description,
        isSensitive: 'sensitive' in def && def.sensitive === true,
        isPastoral: 'pastoral' in def && def.pastoral === true,
        allowedScopes: [...def.scopes],
      };
      await tx.insert(permissions).values({ key, ...values }).onConflictDoUpdate({ target: permissions.key, set: values });
    }

    // System roles and their bundles.
    for (const [key, def] of Object.entries(ROLES)) {
      const values = {
        name: def.name,
        description: def.description,
        isSystem: true,
        defaultScopeType: def.defaultScopeType,
        defaultBranchDepth: 'defaultBranchDepth' in def ? def.defaultBranchDepth : null,
      };
      await tx.insert(roles).values({ key, ...values }).onConflictDoUpdate({ target: roles.key, set: values });
    }
    const systemRoles = await tx
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(inArray(roles.key, Object.keys(ROLES)));
    await tx.delete(rolePermissions).where(inArray(rolePermissions.roleId, systemRoles.map((r) => r.id)));
    for (const role of systemRoles) {
      const bundle = ROLES[role.key as keyof typeof ROLES].permissions;
      await tx.insert(rolePermissions).values(
        bundle.map((entry) => ({
          roleId: role.id,
          permissionKey: bundleEntryKey(entry),
          branchDepthCap: bundleEntryDepthCap(entry),
        })),
      );
    }

    await tx.insert(leadershipLevels).values(LEADERSHIP_LEVELS).onConflictDoNothing({ target: leadershipLevels.depth });
    await tx.insert(designationTypes).values(DESIGNATIONS.map((d) => ({ ...d, isSystem: true }))).onConflictDoNothing();

    for (const [key, def] of Object.entries(SETTINGS)) {
      await tx.insert(systemSettings).values({ key, value: def.defaults }).onConflictDoNothing();
    }

    await ensureDefaultJournalForm(tx);
    await ensurePrayerReportForm(tx);
    await ensureGeneralEntryCode(tx);

    await tx
      .insert(privacyNoticeVersions)
      .values({
        version: INITIAL_PRIVACY_NOTICE_VERSION,
        publishedAt: sql`now()` as unknown as Date,
        bodyMarkdown: DRAFT_PRIVACY_NOTICE,
      })
      .onConflictDoNothing();
  });
}

/**
 * Starter journal questions (docs/04 §4.1). These are EXAMPLES for the ministry to adapt in
 * Daily Journal → Questions; they are only created when the form does not exist yet.
 */
async function ensureDefaultJournalForm(tx: Transaction) {
  const [existing] = await tx.select({ id: forms.id }).from(forms).where(eq(forms.key, 'daily_journal'));
  if (existing) return;
  const [form] = await tx
    .insert(forms)
    .values({ key: 'daily_journal', name: 'Daily Journal', purpose: 'journal', description: 'Questions members answer each day.' })
    .returning({ id: forms.id });
  const [version] = await tx
    .insert(formVersions)
    .values({ formId: form!.id, versionNo: 1, status: 'published', publishedAt: new Date() })
    .returning({ id: formVersions.id });
  const fields: Omit<typeof formFields.$inferInsert, 'formVersionId' | 'sortOrder'>[] = [
    { fieldKey: 'scripture', fieldType: 'scripture_ref', label: 'What did you read in the Bible today?', helpText: 'For example: John 3:16–21', isRequired: false, sensitivity: 'standard' },
    { fieldKey: 'reflection', fieldType: 'reflection', label: 'What is God speaking to you through it?', isRequired: true, sensitivity: 'standard' },
    { fieldKey: 'prayed', fieldType: 'yes_no', label: 'Did you spend time in prayer today?', isRequired: true, sensitivity: 'standard' },
    { fieldKey: 'gratitude', fieldType: 'gratitude', label: 'What are you thankful for today?', isRequired: false, sensitivity: 'standard' },
    { fieldKey: 'prayer_request', fieldType: 'prayer_request', label: 'Is there anything you would like prayer for?', helpText: 'Seen only by your direct leader and the pastoral team.', isRequired: false, sensitivity: 'restricted' },
    { fieldKey: 'pastoral_note', fieldType: 'long_text', label: 'Anything you want to share only with the pastoral team?', helpText: 'Private — your leaders will not see this.', isRequired: false, sensitivity: 'confidential' },
  ];
  await tx.insert(formFields).values(fields.map((f, i) => ({ ...f, formVersionId: version!.id, sortOrder: i })));
}

async function ensureGeneralEntryCode(tx: Transaction) {
  const [existing] = await tx
    .select({ id: entryCodes.id })
    .from(entryCodes)
    .where(and(eq(entryCodes.kind, 'journal_general'), eq(entryCodes.status, 'active')));
  if (existing) return;
  await tx.insert(entryCodes).values({ code: randomCode(8), kind: 'journal_general', label: 'General daily journal' });
}

/**
 * PLACEHOLDER — must be reviewed by the ministry's Data Protection Officer / counsel before
 * public forms go live (milestone M5). Kept deliberately plain.
 */
const DRAFT_PRIVACY_NOTICE = `# Privacy Notice (DRAFT — for review by our Data Protection Officer)

Generation Touch Harvest International ("GenTouch") collects your name, mobile number and,
optionally, email so that your leader can walk with you in your daily journal, prayer chain
and serving schedule.

- **Who sees your information:** your direct leader and authorised ministry leaders.
  Confidential answers are seen only by our pastoral team.
- **Why:** discipleship, pastoral care and ministry scheduling. Never sold or shared for marketing.
- **How long:** journal content is kept for up to 3 years, then deleted.
- **Your rights:** you may ask to see, correct or delete your information by contacting
  our Data Protection Officer.
`;
