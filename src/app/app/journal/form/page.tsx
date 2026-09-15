import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { getFormEditor, JOURNAL_FORM_KEY } from '@/server/modules/forms/forms.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { QuestionsEditor } from './questions-editor';

export const metadata: Metadata = { title: 'Journal questions' };

export default async function JournalQuestionsPage() {
  const { ctx } = await requirePortal();

  let editor;
  try {
    editor = await getFormEditor(getDb(), ctx, JOURNAL_FORM_KEY);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const source = editor.draft ?? editor.published;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/journal', label: 'Daily Journal' }}
        title="Journal questions"
        description="What members are asked each day. Changes are saved as a draft and reach the journal page only when published. Journals already sent keep the questions they answered."
      />
      <QuestionsEditor
        key={source?.versionId ?? 'empty'}
        initialFields={source?.fields ?? []}
        publishedKeys={editor.published?.fields.map((f) => f.key) ?? []}
        publishedVersionNo={editor.published?.versionNo ?? null}
        hasDraft={Boolean(editor.draft)}
        canEdit={editor.canEdit}
        canPublish={editor.canPublish}
      />
    </div>
  );
}
