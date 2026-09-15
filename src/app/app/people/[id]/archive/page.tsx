import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { getPersonDetail } from '@/server/modules/people/people.queries';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { ArchiveForm } from './archive-form';

export const metadata: Metadata = { title: 'Archive person' };

export default async function ArchivePersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePortal();

  let detail;
  try {
    detail = await getPersonDetail(getDb(), ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  if (!detail.can.archive) notFound();
  const leadsGroup = (detail.leadership?.directCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/app/people/${detail.person.id}`, label: detail.person.name }}
        title={`Archive ${detail.person.firstName}?`}
        description="Archived people disappear from lists, selectors and reminders. Their history is kept, and portal access ends."
      />
      {leadsGroup ? (
        <Alert tone="warning" title="Reassign their group first">
          {detail.person.firstName} leads {detail.leadership!.directCount} {detail.leadership!.directCount === 1 ? 'person' : 'people'}. Move
          their group to another leader before archiving (Change leader → leave their group with another leader).
        </Alert>
      ) : (
        <ArchiveForm personId={detail.person.id} />
      )}
    </div>
  );
}
