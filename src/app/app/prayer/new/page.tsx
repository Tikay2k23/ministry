import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { localDate } from '@/server/modules/journal/journal-dates';
import { chainCreationOptions } from '@/server/modules/prayer/chains.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { CreateChainForm } from './create-chain-form';

export const metadata: Metadata = { title: 'New prayer chain' };

/** The new chain wizard (docs/05 W10 steps 1–4): basics, the slot pattern and a few choices. */
export default async function NewChainPage() {
  const { ctx } = await requirePortal();
  const db = getDb();
  const [options, profile] = await Promise.all([chainCreationOptions(db, ctx), getSetting(db, 'ministry.profile')]);
  if (!options.canCreate) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/app/prayer', label: 'Prayer Chain' }}
        title="New prayer chain"
        description="Set the pattern of prayer slots. You can add people and start the chain on the next page."
      />
      <CreateChainForm
        ministries={options.ministries}
        requiresMinistry={options.requiresMinistry}
        defaultTimezone={profile.timezone}
        today={localDate(ctx.now, profile.timezone)}
      />
    </div>
  );
}
