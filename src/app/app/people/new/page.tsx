import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { getPersonName, listDesignationTypes } from '@/server/modules/people/people.queries';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { PersonForm } from '../person-form';

export const metadata: Metadata = { title: 'Add a person' };

export default async function NewPersonPage({ searchParams }: { searchParams: Promise<{ leaderId?: string }> }) {
  const { ctx } = await requirePortal();
  if (!hasPermission(ctx, 'people.create')) notFound();
  const db = getDb();
  const { leaderId } = await searchParams;

  const [fields, designations, defaultLeader] = await Promise.all([
    getSetting(db, 'people.fields'),
    listDesignationTypes(db),
    leaderId ? getPersonName(db, ctx, leaderId, 'people.create') : Promise.resolve(null),
  ]);
  const leaderRequired = !hasGlobal(ctx, 'people.create');

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/people', label: 'People' }}
        title="Add a person"
        description={leaderRequired ? 'New people join a group you lead.' : 'Add someone to the directory.'}
      />
      <PersonForm
        mode="create"
        initial={{
          firstName: '',
          lastName: '',
          middleName: null,
          suffix: null,
          preferredName: null,
          gender: null,
          joinedOn: null,
          journalExpected: true,
          designations: ['member'],
          contact: null,
        }}
        designationOptions={designations}
        fields={fields}
        canEditContact
        leader={{ defaultValue: defaultLeader, required: leaderRequired }}
      />
    </div>
  );
}
