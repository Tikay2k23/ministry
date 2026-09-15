import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { getPersonDetail } from '@/server/modules/people/people.queries';
import { hasGlobal } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { MoveForm } from './move-form';

export const metadata: Metadata = { title: 'Change leader' };

export default async function MovePersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePortal();

  let detail;
  try {
    detail = await getPersonDetail(getDb(), ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { person, leadership, can } = detail;
  if (person.archivedAt) notFound();

  const intent = !leadership ? 'place' : can.move ? 'move' : 'request';
  if (intent === 'place' && !can.move) notFound();

  const titles = { place: 'Place in the leadership structure', move: 'Change leader', request: 'Request a leader change' };
  const descriptions = {
    place: `Choose who disciples ${person.firstName}.`,
    move: `${person.firstName}’s leader is ${leadership?.leader?.name ?? 'not set (top of the structure)'}. Moves take effect immediately and are recorded in their history.`,
    request: `You can’t move people yourself. Your request goes to the receiving leader or a Primary Leader for approval.`,
  };

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: `/app/people/${person.id}`, label: person.name }} title={titles[intent]} description={descriptions[intent]} />
      <MoveForm
        intent={intent}
        personId={person.id}
        personFirstName={person.firstName}
        currentLeaderId={leadership?.leader?.id ?? null}
        directCount={leadership?.directCount ?? 0}
        canPlaceAtTop={hasGlobal(ctx, 'hierarchy.manage')}
      />
    </div>
  );
}
