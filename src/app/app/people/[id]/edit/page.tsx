import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { getPersonForEdit, listDesignationTypes } from '@/server/modules/people/people.queries';
import { getSetting } from '@/server/modules/settings/settings.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { PersonForm } from '../../person-form';

export const metadata: Metadata = { title: 'Edit person' };

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePortal();
  const db = getDb();

  let person;
  try {
    person = await getPersonForEdit(db, ctx, id);
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const [fields, designations] = await Promise.all([getSetting(db, 'people.fields'), listDesignationTypes(db)]);

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: `/app/people/${person.id}`, label: `${person.firstName} ${person.lastName}` }} title="Edit person" />
      <PersonForm
        mode="edit"
        personId={person.id}
        expectedUpdatedAt={person.updatedAt}
        initial={{
          firstName: person.firstName,
          lastName: person.lastName,
          middleName: person.middleName,
          suffix: person.suffix,
          preferredName: person.preferredName,
          gender: person.gender,
          joinedOn: person.joinedOn,
          status: person.status,
          journalExpected: person.journalExpected,
          designations: person.designations,
          contact: person.contact,
        }}
        designationOptions={designations}
        fields={fields}
        canEditContact={person.canEditContact}
      />
    </div>
  );
}
