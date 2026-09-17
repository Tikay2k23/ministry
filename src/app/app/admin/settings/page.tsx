import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SectionCard } from '@/components/portal/section-card';
import { PageHeader } from '@/components/ui/page-header';
import { getSetting, listLeadershipLevels } from '@/server/modules/settings/settings.service';
import { hasGlobal } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { AdminTabs } from '../admin-tabs';
import { GeneralForm, HierarchyForm, JournalPolicyForm, LeadershipLevelsEditor, PeopleFieldsForm, PrivacyForm, PublicFormsForm } from './settings-forms';

export const metadata: Metadata = { title: 'Settings' };

/** Settings (docs/04 A26): ministry-level choices without code, each with what it means for people. */
export default async function SettingsPage() {
  const { ctx } = await requirePortal();
  const canViewAll = hasGlobal(ctx, 'settings.view');
  const canEditJournal = hasGlobal(ctx, 'journal.settings.manage');
  if (!canViewAll && !canEditJournal) notFound();
  const canEdit = hasGlobal(ctx, 'settings.manage');

  const db = getDb();
  const [profile, peopleFields, hierarchy, journalPolicy, identification, privacy, levels] = await Promise.all([
    getSetting(db, 'ministry.profile'),
    getSetting(db, 'people.fields'),
    getSetting(db, 'hierarchy'),
    getSetting(db, 'journal.policy'),
    getSetting(db, 'public.identification'),
    getSetting(db, 'privacy'),
    listLeadershipLevels(db),
  ]);
  const timeZones = Intl.supportedValuesOf('timeZone');

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="How the system works for your ministry. Every change is recorded." />
      <AdminTabs health={canEdit} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <SectionCard title="Daily Journal" description="When journals are due, and who may read them.">
            <JournalPolicyForm value={journalPolicy} canEdit={canEditJournal} />
          </SectionCard>
          {canViewAll && (
            <SectionCard title="Leadership" description="How the leadership tree is read.">
              <HierarchyForm value={hierarchy} canEdit={canEdit} />
              <div className="space-y-2 border-t border-line pt-4">
                <h3 className="font-semibold">Level names</h3>
                <p className="text-sm text-muted">What each level of the tree is called, from the top down.</p>
                <LeadershipLevelsEditor levels={levels} canEdit={canEdit} />
              </div>
            </SectionCard>
          )}
        </div>

        {canViewAll && (
          <div className="min-w-0 space-y-6">
            <SectionCard title="General" description="Shown on public pages and in emails.">
              <GeneralForm value={profile} timeZones={timeZones.includes(profile.timezone) ? timeZones : [profile.timezone, ...timeZones]} canEdit={canEdit} />
            </SectionCard>
            <SectionCard title="People fields" description="What the directory asks for. Collect only what your leaders need.">
              <PeopleFieldsForm value={peopleFields} canEdit={canEdit} />
            </SectionCard>
            <SectionCard title="Public journal page" description="How members are recognised when they journal.">
              <PublicFormsForm value={identification} canEdit={canEdit} />
            </SectionCard>
            <SectionCard title="Privacy" description="Consent, and young people who take part.">
              <PrivacyForm value={privacy} canEdit={canEdit} />
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}
