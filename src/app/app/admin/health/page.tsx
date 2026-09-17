import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SectionCard } from '@/components/portal/section-card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { formatDateTime } from '@/lib/dates';
import { getSystemHealth } from '@/server/modules/settings/health.service';
import { getSetting } from '@/server/modules/settings/settings.service';
import { hasGlobal } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { AdminTabs } from '../admin-tabs';
import { RunJobButton } from './run-job-button';

export const metadata: Metadata = { title: 'System health' };

const EMAIL_PROVIDER: Record<string, string> = {
  resend: 'Resend',
  console: 'Printed in the server log (development)',
  file: 'Saved to files (tests)',
};
const SCHEDULER_MODE: Record<string, string> = {
  in_process: 'Inside the app, every minute',
  external: 'Supabase Cron, every minute',
  off: 'Off',
};

function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toLocaleString('en-PH', { maximumFractionDigits: 1 })} MB`;
}

function every(minutes: number) {
  if (minutes < 60) return minutes === 1 ? 'every minute' : `every ${minutes} minutes`;
  return minutes === 60 ? 'hourly' : minutes === 1440 ? 'daily' : `every ${minutes / 60} hours`;
}

/** System health (docs/04 A29): background jobs, sending, and how this installation is set up. */
export default async function SystemHealthPage() {
  const { ctx } = await requirePortal();
  if (!hasGlobal(ctx, 'settings.manage')) notFound();
  const db = getDb();
  const [health, profile] = await Promise.all([getSystemHealth(db, ctx), getSetting(db, 'ministry.profile')]);
  const when = (date: Date | null) => (date ? formatDateTime(date, profile.timezone) : '—');
  const failing = health.jobs.filter((job) => job.lastStatus === 'error');

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="How the system works for your ministry. Every change is recorded." />
      <AdminTabs health />

      {health.scheduler.stalled && (
        <Alert tone="warning" title="Background jobs have stopped">
          Nothing has run since {when(health.scheduler.lastTickAt)}. Reminders, follow-ups and emails wait until jobs run again.{' '}
          {health.scheduler.mode === 'external'
            ? 'Check the Supabase Cron schedule (deploy/supabase-cron.sql) and that CRON_SECRET matches.'
            : health.scheduler.mode === 'off'
              ? 'SCHEDULER_MODE is off.'
              : 'Restart the app.'}
        </Alert>
      )}
      {!health.scheduler.stalled && failing.length > 0 && (
        <Alert tone="warning" title={failing.length === 1 ? 'A background job is failing' : `${failing.length} background jobs are failing`}>
          They try again every few minutes. Administrators are emailed once a day while a job keeps failing.
        </Alert>
      )}

      <SectionCard title="Background jobs" description={`${SCHEDULER_MODE[health.scheduler.mode] ?? health.scheduler.mode}. Last run: ${when(health.scheduler.lastTickAt)}.`}>
        <ul className="divide-y divide-line">
          {health.jobs.map((job) => (
            <li key={job.key} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {job.label}
                  {job.lastStatus === 'ok' && <Badge tone="green">Working</Badge>}
                  {job.lastStatus === 'error' && <Badge tone="amber">Failing</Badge>}
                  {job.lastStatus === 'running' && <Badge>Running</Badge>}
                  {job.lastStatus === null && <Badge tone="slate">Not run yet</Badge>}
                </p>
                <p className="text-sm text-muted">
                  Runs {every(job.everyMinutes)} · last {when(job.lastStartedAt)} · next {when(job.nextRunAt)}
                </p>
                <p className="text-xs text-muted">
                  {job.key} · {job.runCount.toLocaleString('en-PH')} runs{job.failureCount > 0 ? `, ${job.failureCount.toLocaleString('en-PH')} failed` : ''}
                </p>
                {job.lastError && <p className="text-sm break-words text-warn">{job.lastError}</p>}
              </div>
              <RunJobButton jobKey={job.key} label={job.label} />
            </li>
          ))}
        </ul>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Sending" description="Emails and in-app notices.">
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-ground p-3">
              <dt className="text-xs text-muted">Waiting</dt>
              <dd className="tabular text-2xl font-bold">{health.notifications.waiting.toLocaleString('en-PH')}</dd>
            </div>
            <div className="rounded-lg bg-ground p-3">
              <dt className="text-xs text-muted">Sent today</dt>
              <dd className="tabular text-2xl font-bold">{health.notifications.sent.toLocaleString('en-PH')}</dd>
            </div>
            <div className="rounded-lg bg-ground p-3">
              <dt className="text-xs text-muted">Failed this week</dt>
              <dd className="tabular text-2xl font-bold">{health.notifications.failed.toLocaleString('en-PH')}</dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard title="This installation" description="Which services are in use. Keys and passwords are never shown.">
          <dl className="space-y-2 text-sm">
            {[
              ['Environment', health.configuration.environment],
              ['Address', health.configuration.appUrl],
              ['Email', EMAIL_PROVIDER[health.configuration.emailProvider] ?? health.configuration.emailProvider],
              ['Rate limits kept in', health.configuration.rateLimitStore === 'upstash' ? 'Upstash Redis' : 'The database'],
              ['Error tracking', health.configuration.errorTracking ? 'Sentry' : 'Off (errors are only logged)'],
              ['Database', `${health.configuration.database === 'embedded' ? 'Embedded (development)' : 'PostgreSQL'} · ${megabytes(health.databaseBytes)}`],
            ].map(([term, detail]) => (
              <div key={term} className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted">{term}</dt>
                <dd className="text-right break-all">{detail}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </div>
    </div>
  );
}
