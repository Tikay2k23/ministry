import { ChevronRight, Pencil, UserPlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DayDots, formatDayLabel, JournalStatus } from '@/components/journal/journal-status';
import { formatDateTime } from '@/lib/dates';
import { isAppError } from '@/server/errors';
import { listPauses } from '@/server/modules/journal/journal-calendar.service';
import { getPersonJournalSummary } from '@/server/modules/journal/journal-portal.service';
import { listAssignableMinistries } from '@/server/modules/ministries/ministries.service';
import { getPersonDetail, type PersonDetail } from '@/server/modules/people/people.queries';
import { grantableRolesForPerson } from '@/server/modules/iam/users.service';
import { canAccessPerson, hasGlobal, hasPermission } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { MinistryMembershipForm } from './ministry-membership-form';
import { PauseManager } from './pause-manager';
import { PersonalLinkCard } from './personal-link-card';
import { PortalAccessCard } from './portal-access-card';

export const metadata: Metadata = { title: 'Person' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const POSITION_LABEL: Record<string, string> = { member: 'Member', worker: 'Worker', assistant_head: 'Assistant head', head: 'Head' };
const CHANGE_LABEL: Record<string, string> = {
  placed: 'Placed in the structure',
  moved: 'Moved to a new leader',
  removed: 'Removed from the structure',
  group_reassigned: 'Group reassigned',
};

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePortal();
  const db = getDb();

  let detail: PersonDetail;
  try {
    detail = await getPersonDetail(db, ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { person, contact, leadership, can } = detail;
  const [assignable, access] = await Promise.all([
    can.manageMinistries ? listAssignableMinistries(db, ctx) : Promise.resolve([]),
    can.manageAccess ? grantableRolesForPerson(db, ctx, person.id) : Promise.resolve({ roles: [], ministries: [] }),
  ]);

  // Daily Journal: status history only for people within the viewer's journal scope.
  const journal =
    hasPermission(ctx, 'journal.status.view') && !person.archivedAt
      ? await getPersonJournalSummary(db, ctx, person.id).catch((error: unknown) => {
          if (isAppError(error) && error.code === 'NOT_FOUND') return null;
          throw error;
        })
      : null;
  const [pauses, canIssueLink] = await Promise.all([
    journal?.canExcuse ? listPauses(db, ctx, person.id) : Promise.resolve([]),
    person.archivedAt ? Promise.resolve(false) : canAccessPerson(db, ctx, 'people.links.issue', person.id),
  ]);
  const isSelf = ctx.actor.kind === 'user' && ctx.actor.personId === person.id;
  const canShowQr =
    !person.archivedAt &&
    Boolean(leadership && (leadership.directCount > 0 || leadership.acceptsMembers)) &&
    (hasGlobal(ctx, 'links.manage') || (isSelf && hasPermission(ctx, 'links.own.manage')));
  const recentDays = journal ? journal.days.slice(-7).reverse().filter((d) => d.status !== null) : [];

  return (
    <div className="space-y-6">
      <Link href="/app/people" className="text-sm text-muted hover:text-ink">
        ← People
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl">{person.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="tabular text-muted">{person.personCode}</span>
            {leadership?.levelName && <Badge tone="green">{leadership.levelName}</Badge>}
            {leadership && leadership.directCount > 0 && <Badge tone="green">Leads {leadership.directCount}</Badge>}
            {person.status === 'inactive' && <Badge>Inactive</Badge>}
            {person.registrationStatus === 'unconfirmed' && <Badge tone="amber">Unconfirmed registration</Badge>}
            {person.archivedAt && <Badge tone="red">Archived</Badge>}
            {detail.designations.map((d) => (
              <Badge key={d.key} tone="slate">
                {d.name}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can.addToGroup && (
            <Button asChild variant="secondary">
              <Link href={`/app/people/new?leaderId=${person.id}`}>
                <UserPlus aria-hidden className="size-4" /> Add to group
              </Link>
            </Button>
          )}
          {(can.move || (leadership && !person.archivedAt)) && (
            <Button asChild variant="secondary">
              <Link href={`/app/people/${person.id}/move`}>
                {can.move ? (leadership ? 'Change leader' : 'Place in structure') : 'Request leader change'}
              </Link>
            </Button>
          )}
          {can.edit && (
            <Button asChild>
              <Link href={`/app/people/${person.id}/edit`}>
                <Pencil aria-hidden className="size-4" /> Edit
              </Link>
            </Button>
          )}
        </div>
      </header>

      {leadership && leadership.chain.length > 0 && (
        <nav aria-label="Chain of leadership" className="flex flex-wrap items-center gap-1 text-sm text-muted">
          {leadership.chain.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              {c.viewable ? (
                <Link href={`/app/people/${c.id}`} className="hover:text-brand-deep hover:underline">
                  {c.name}
                </Link>
              ) : (
                <span>{c.name}</span>
              )}
              <ChevronRight aria-hidden className="size-3.5" />
            </span>
          ))}
          <span className="font-semibold text-ink">{person.name}</span>
        </nav>
      )}

      {person.archivedAt && (
        <Alert tone="info" title="This person is archived">
          Archived on {formatDateTime(person.archivedAt, detail.timezone)} ({person.archivedReason}). History is kept.
        </Alert>
      )}
      {detail.pendingRequest && (
        <Alert tone="info" title="Leader change requested">
          A request to move {person.firstName} to {detail.pendingRequest.toLeaderName} is waiting for approval.{' '}
          <Link href="/app/leadership/requests" className="font-semibold underline">
            View requests
          </Link>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Section
            title={leadership ? `Group (${leadership.directCount})` : 'Leadership'}
            action={
              leadership && leadership.directCount > 0 ? (
                <Link href={`/app/people?leaderId=${person.id}`} className="text-sm text-brand-deep hover:underline">
                  Open in directory
                </Link>
              ) : undefined
            }
          >
            {!leadership ? (
              <p className="text-sm text-muted">Not placed in the leadership structure yet.</p>
            ) : (
              <>
                <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">Direct leader</dt>
                    <dd className="font-medium">
                      {leadership.leader ? (
                        leadership.leader.viewable ? (
                          <Link href={`/app/people/${leadership.leader.id}`} className="hover:underline">
                            {leadership.leader.name}
                          </Link>
                        ) : (
                          leadership.leader.name
                        )
                      ) : (
                        'Top of the structure'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Primary leader</dt>
                    <dd className="font-medium">{leadership.primaryLeader?.name ?? (leadership.depth === 1 ? 'Is a Primary Leader' : '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Whole branch</dt>
                    <dd className="tabular font-medium">{leadership.branchSize.toLocaleString('en-PH')} people</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Shown in leader selector</dt>
                    <dd className="font-medium">{leadership.acceptsMembers ? 'Yes' : 'No'}</dd>
                  </div>
                </dl>
                {leadership.group.length === 0 ? (
                  <p className="text-sm text-muted">
                    {leadership.directCount > 0 ? 'Their group is outside what you can see.' : 'No one in their group yet.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {leadership.group.map((member) => (
                      <li key={member.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <Link href={`/app/people/${member.id}`} className="font-medium hover:text-brand-deep hover:underline">
                          {member.name}
                        </Link>
                        <span className="flex items-center gap-2 text-muted">
                          {member.groupSize > 0 && <span className="tabular">leads {member.groupSize}</span>}
                          {member.status === 'inactive' && <Badge>Inactive</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Section>

          {journal && (
            <Section
              title="Daily Journal"
              action={
                <Link href={`/app/journal/${person.id}/${journal.today}`} className="text-sm text-brand-deep hover:underline">
                  Today’s journal
                </Link>
              }
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <DayDots days={journal.days} size="md" />
                  <p className="text-sm text-muted">
                    Last 30 days
                    {journal.consistency &&
                      ` · ${journal.consistency.received} received${
                        journal.consistency.of > journal.consistency.received ? ` of ${journal.consistency.of} expected` : ''
                      }`}
                  </p>
                  {!person.journalExpected && <p className="text-sm text-muted">Not expected to journal (set on their record).</p>}
                  {person.registrationStatus === 'unconfirmed' && (
                    <p className="text-sm text-muted">Expected to journal once their registration is confirmed.</p>
                  )}
                </div>
                {recentDays.length > 0 && (
                  <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                    {recentDays.map((d) => (
                      <li key={d.date}>
                        <Link href={`/app/journal/${person.id}/${d.date}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-ground/60">
                          <span>{formatDayLabel(d.date, 'short')}</span>
                          <JournalStatus status={d.status!} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {journal.canProxy && (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/app/people/${person.id}/journal/new`}>Record a journal shared by phone</Link>
                  </Button>
                )}
                {journal.canExcuse && (
                  <div className="border-t border-line pt-4">
                    <h3 className="mb-2 text-sm font-semibold">Pauses</h3>
                    <PauseManager personId={person.id} today={journal.today} pauses={pauses} />
                  </div>
                )}
              </div>
            </Section>
          )}

          {detail.history.length > 0 && (
            <Section title="Leadership history">
              <ol className="space-y-3 text-sm">
                {detail.history.map((h, i) => (
                  <li key={i} className="border-l-2 border-line pl-3">
                    <p className="font-medium">{CHANGE_LABEL[h.changeType] ?? h.changeType}</p>
                    <p className="text-muted">
                      {h.previousLeaderName && <>From {h.previousLeaderName} </>}
                      {h.newLeaderName && <>to {h.newLeaderName} </>}· {formatDateTime(h.effectiveAt, detail.timezone)}
                    </p>
                    {h.reason && <p className="text-muted">“{h.reason}”</p>}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {detail.audit && detail.audit.length > 0 && (
            <Section title="Activity">
              <ul className="space-y-2 text-sm">
                {detail.audit.map((a, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-2">
                    <span>
                      <code className="text-xs">{a.action}</code> {a.actorName && <span className="text-muted">by {a.actorName}</span>}
                    </span>
                    <span className="tabular text-muted">{formatDateTime(a.occurredAt, detail.timezone)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Contact">
            {!contact ? (
              <p className="text-sm text-muted">Contact details are visible to this person’s leaders and the ministry office.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted">Mobile</dt>
                  <dd className="tabular font-medium">
                    {contact.phone ? <a href={`tel:${contact.phoneE164}`} className="hover:underline">{contact.phone}</a> : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Email</dt>
                  <dd className="font-medium break-all">{contact.email ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Birthday</dt>
                  <dd className="font-medium">
                    {contact.birthday
                      ? `${MONTHS[contact.birthday.month - 1]} ${contact.birthday.day ?? ''}${contact.birthday.year ? `, ${contact.birthday.year}` : ''}`
                      : '—'}
                  </dd>
                </div>
                {contact.address && (
                  <div>
                    <dt className="text-muted">Address</dt>
                    <dd className="font-medium">{contact.address}</dd>
                  </div>
                )}
              </dl>
            )}
          </Section>

          <Section title="Serving">
            {detail.memberships.length === 0 && detail.teams.length === 0 && <p className="text-sm text-muted">Not serving in a ministry yet.</p>}
            {detail.memberships.length > 0 && (
              <ul className="space-y-2 text-sm">
                {detail.memberships.map((m) => (
                  <li key={m.id}>
                    <Link href={`/app/ministries/${m.ministryId}`} className="font-medium hover:underline">
                      {m.ministryName}
                    </Link>
                    <span className="text-muted">
                      {' '}
                      · {POSITION_LABEL[m.position] ?? m.position}
                      {m.departmentName ? ` · ${m.departmentName}` : ''}
                      {m.isPrimary ? ' · primary' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {detail.teams.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {detail.teams.map((t) => (
                  <li key={t.id} className="text-muted">
                    Team <span className="font-medium text-ink">{t.teamName}</span> · {t.ministryName}
                  </li>
                ))}
              </ul>
            )}
            {can.manageMinistries && assignable.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <MinistryMembershipForm personId={person.id} ministries={assignable} />
              </div>
            )}
          </Section>

          {(canIssueLink || canShowQr) && (
            <Section title="Journal access">
              <div className="space-y-4">
                {canIssueLink && <PersonalLinkCard personId={person.id} firstName={person.firstName} />}
                {canShowQr && (
                  <div className={canIssueLink ? 'space-y-1 border-t border-line pt-4' : 'space-y-1'}>
                    <Link href={`/app/people/${person.id}/qr`} className="text-sm font-medium text-brand-deep hover:underline">
                      {isSelf ? 'Your' : `${person.firstName}’s`} journal QR code
                    </Link>
                    <p className="text-sm text-muted">Print it for the group. Scanning it opens the journal with this leader already chosen.</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {(detail.account || can.manageAccess) && (
            <Section title="Portal access">
              <PortalAccessCard
                personId={person.id}
                personEmail={contact?.email ?? null}
                account={detail.account}
                canManage={can.manageAccess}
                roles={access.roles}
                ministries={access.ministries}
              />
            </Section>
          )}

          <Section title="Record">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Joined</dt>
                <dd>{person.joinedOn ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Added</dt>
                <dd className="tabular">{formatDateTime(person.createdAt, detail.timezone)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Source</dt>
                <dd>{person.source.replace('_', ' ')}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Journal expected</dt>
                <dd>{person.journalExpected ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
            {can.archive && (
              <div className="mt-4 border-t border-line pt-4">
                <Link href={`/app/people/${person.id}/archive`} className="text-sm text-error hover:underline">
                  Archive this person…
                </Link>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
