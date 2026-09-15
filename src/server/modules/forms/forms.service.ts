import { and, asc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { actorUserId, type RequestContext } from '../../context/request-context';
import type { Database, Executor } from '../../db/client';
import { FORM_FIELD_TYPES, SENSITIVITIES } from '../../db/enums';
import { formFields, forms, formVersions } from '../../db/schema';
import { invalidState, notFound, validationError } from '../../errors';
import { assertGlobal, hasGlobal } from '../../policy/can';
import { parseInput } from '../../validation';
import { recordAudit } from '../audit/audit.service';
import { CHOICE_FIELD_TYPES, type FieldConfig, type FieldDefinition } from './answers';

export const JOURNAL_FORM_KEY = 'daily_journal';

type FieldRow = typeof formFields.$inferSelect;

export function toFieldDefinition(row: FieldRow): FieldDefinition {
  return {
    key: row.fieldKey,
    type: row.fieldType,
    label: row.label,
    helpText: row.helpText,
    required: row.isRequired,
    sensitivity: row.sensitivity,
    config: (row.config ?? {}) as FieldConfig,
  };
}

export interface FormVersionView {
  formId: string;
  formKey: string;
  versionId: string;
  versionNo: number;
  status: 'draft' | 'published' | 'retired';
  publishedAt: Date | null;
  retiredAt: Date | null;
  fields: FieldDefinition[];
}

async function versionView(executor: Executor, where: ReturnType<typeof and>): Promise<FormVersionView | null> {
  const [version] = await executor
    .select({
      formId: forms.id,
      formKey: forms.key,
      versionId: formVersions.id,
      versionNo: formVersions.versionNo,
      status: formVersions.status,
      publishedAt: formVersions.publishedAt,
      retiredAt: formVersions.retiredAt,
    })
    .from(formVersions)
    .innerJoin(forms, eq(forms.id, formVersions.formId))
    .where(where);
  if (!version) return null;
  const rows = await executor
    .select()
    .from(formFields)
    .where(eq(formFields.formVersionId, version.versionId))
    .orderBy(asc(formFields.sortOrder));
  return { ...version, fields: rows.map(toFieldDefinition) };
}

export function getPublishedForm(executor: Executor, formKey: string) {
  return versionView(executor, and(eq(forms.key, formKey), eq(formVersions.status, 'published')));
}

export function getFormVersion(executor: Executor, versionId: string) {
  return versionView(executor, and(eq(formVersions.id, versionId)));
}

// ─── Editor (docs/04 A14) ─────────────────────────────────────────────────────

const keyPattern = /^[a-z][a-z0-9_]{1,62}$/;

export const FieldInput = z.object({
  key: z.string().regex(keyPattern, 'Use lowercase letters, numbers and underscores'),
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string().trim().min(1, 'Enter the question').max(300),
  helpText: z.string().trim().max(500).nullish(),
  required: z.boolean(),
  sensitivity: z.enum(SENSITIVITIES),
  options: z
    .array(z.object({ key: z.string().regex(keyPattern), label: z.string().trim().min(1).max(120) }))
    .max(30)
    .optional(),
  maxLength: z.int().min(1).max(10_000).optional(),
});

export type FieldInputValue = z.infer<typeof FieldInput>;

export const SaveDraftInput = z.object({
  formKey: z.string().regex(keyPattern),
  fields: z.array(FieldInput).min(1, 'Add at least one question').max(40, 'A form can have at most 40 questions'),
});

export async function getFormEditor(db: Executor, ctx: RequestContext, formKey: string) {
  if (!hasGlobal(ctx, 'forms.manage') && !hasGlobal(ctx, 'forms.publish')) throw notFound('form');
  const [form] = await db.select().from(forms).where(eq(forms.key, formKey));
  if (!form) throw notFound('form');
  const [published, draft] = await Promise.all([
    getPublishedForm(db, formKey),
    versionView(db, and(eq(forms.key, formKey), eq(formVersions.status, 'draft'))),
  ]);
  return {
    form: { id: form.id, key: form.key, name: form.name },
    published,
    draft,
    canEdit: hasGlobal(ctx, 'forms.manage'),
    canPublish: hasGlobal(ctx, 'forms.publish'),
  };
}

export async function saveFormDraft(db: Database, ctx: RequestContext, raw: unknown) {
  const input = parseInput(SaveDraftInput, raw);
  assertGlobal(ctx, 'forms.manage');

  const errors: Record<string, string[]> = {};
  const keys = new Set<string>();
  input.fields.forEach((field, i) => {
    if (keys.has(field.key)) (errors[`fields.${i}.key`] ??= []).push('Two questions use the same key.');
    keys.add(field.key);
    const isChoice = (CHOICE_FIELD_TYPES as readonly string[]).includes(field.type);
    const options = field.options ?? [];
    if (isChoice && options.length < 2) (errors[`fields.${i}.options`] ??= []).push('Add at least two options.');
    if (isChoice && new Set(options.map((o) => o.key)).size !== options.length) {
      (errors[`fields.${i}.options`] ??= []).push('Options must be different.');
    }
  });
  if (Object.keys(errors).length) throw validationError(errors);

  return db.transaction(async (tx) => {
    const [form] = await tx.select().from(forms).where(eq(forms.key, input.formKey)).for('update');
    if (!form) throw notFound('form');

    let [draft] = await tx
      .select()
      .from(formVersions)
      .where(and(eq(formVersions.formId, form.id), eq(formVersions.status, 'draft')));
    if (!draft) {
      const [latest] = await tx.select({ n: max(formVersions.versionNo) }).from(formVersions).where(eq(formVersions.formId, form.id));
      [draft] = await tx
        .insert(formVersions)
        .values({ formId: form.id, versionNo: (latest?.n ?? 0) + 1, status: 'draft' })
        .returning();
    }

    await tx.delete(formFields).where(eq(formFields.formVersionId, draft!.id));
    await tx.insert(formFields).values(
      input.fields.map((field, index) => ({
        formVersionId: draft!.id,
        fieldKey: field.key,
        fieldType: field.type,
        label: field.label,
        helpText: field.helpText ?? null,
        isRequired: field.required,
        sensitivity: field.sensitivity,
        config: {
          ...((CHOICE_FIELD_TYPES as readonly string[]).includes(field.type) ? { options: field.options } : {}),
          ...(field.maxLength ? { maxLength: field.maxLength } : {}),
        },
        sortOrder: index,
      })),
    );
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'form.draft_saved',
      entityType: 'form',
      entityId: form.id,
      newValues: { versionNo: draft!.versionNo, questions: input.fields.length },
    });
    return { versionNo: draft!.versionNo };
  });
}

export async function publishFormDraft(db: Database, ctx: RequestContext, raw: unknown) {
  const { formKey } = parseInput(z.object({ formKey: z.string().regex(keyPattern) }), raw);
  assertGlobal(ctx, 'forms.publish');
  return db.transaction(async (tx) => {
    const [form] = await tx.select().from(forms).where(eq(forms.key, formKey)).for('update');
    if (!form) throw notFound('form');
    const [draft] = await tx
      .select()
      .from(formVersions)
      .where(and(eq(formVersions.formId, form.id), eq(formVersions.status, 'draft')));
    if (!draft) throw invalidState('There are no unpublished changes.');
    const fieldCount = (await tx.select({ id: formFields.id }).from(formFields).where(eq(formFields.formVersionId, draft.id))).length;
    if (fieldCount === 0) throw invalidState('Add at least one question before publishing.');

    await tx
      .update(formVersions)
      .set({ status: 'retired', retiredAt: ctx.now })
      .where(and(eq(formVersions.formId, form.id), eq(formVersions.status, 'published')));
    await tx
      .update(formVersions)
      .set({ status: 'published', publishedAt: ctx.now, publishedBy: actorUserId(ctx) })
      .where(eq(formVersions.id, draft.id));
    await recordAudit(tx, ctx, {
      category: 'change',
      action: 'form.published',
      entityType: 'form',
      entityId: form.id,
      newValues: { versionNo: draft.versionNo, questions: fieldCount },
    });
    return { versionNo: draft.versionNo };
  });
}

export async function discardFormDraft(db: Database, ctx: RequestContext, raw: unknown) {
  const { formKey } = parseInput(z.object({ formKey: z.string().regex(keyPattern) }), raw);
  assertGlobal(ctx, 'forms.manage');
  return db.transaction(async (tx) => {
    const [form] = await tx.select().from(forms).where(eq(forms.key, formKey));
    if (!form) throw notFound('form');
    const deleted = await tx
      .delete(formVersions)
      .where(and(eq(formVersions.formId, form.id), eq(formVersions.status, 'draft')))
      .returning({ id: formVersions.id });
    if (deleted.length === 0) throw invalidState('There are no unpublished changes.');
    await recordAudit(tx, ctx, { category: 'change', action: 'form.draft_discarded', entityType: 'form', entityId: form.id });
  });
}
