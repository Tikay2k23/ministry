import { editJournal, getPublicJournalState, submitJournal } from '@/server/modules/journal/journal-submit.service';
import { recordEntryCodeScan, resolveEntryCode } from '@/server/modules/public/entry-codes.service';
import { assertFormSession, issueFormSession } from '@/server/modules/public/participants.service';
import { publicJsonRoute, readFormSession } from '@/server/next/public-route';

/**
 * GET  /api/public/journal?code=XXXXXXXX[&scan=1] — page state for /j and /j/[code]
 * POST /api/public/journal — submit today's (or, before the late cutoff, yesterday's) journal
 * PUT  /api/public/journal — edit a journal before the deadline (remembered devices only)
 */

export const GET = publicJsonRoute(async ({ request, db, req, identity }) => {
  const params = request.nextUrl.searchParams;
  const rawCode = params.get('code');
  const code = rawCode ? await resolveEntryCode(db, rawCode) : null;
  if (code && params.get('scan') === '1') {
    await recordEntryCodeScan(db, code.id, req.now).catch(() => undefined);
  }

  const who = await identity();
  const state = who ? await getPublicJournalState(db, who, req.now) : null;
  const codeLeader = code?.status === 'active' && code.leader?.placed ? code.leader : null;

  return {
    formSession: issueFormSession(req.now),
    code: rawCode
      ? {
          found: Boolean(code),
          // Retired codes never reveal their replacement: a leaked code must stop working.
          active: code?.status === 'active',
          kind: code?.kind ?? null,
          leader: codeLeader
            ? { ref: code!.code, name: `${codeLeader.firstName} ${codeLeader.lastName.charAt(0)}.`, acceptsMembers: codeLeader.acceptsMembers }
            : null,
        }
      : null,
    participant:
      state && who
        ? {
            firstName: state.person.firstName,
            leaderName: state.leader?.name ?? null,
            rememberedDevice: who.persistent,
            timezone: state.timezone,
            form: state.form,
            dates: state.dates,
          }
        : null,
    leaderMismatch: Boolean(state && codeLeader && code?.kind === 'journal_leader' && codeLeader.personId !== state.leader?.id),
  };
});

export const POST = publicJsonRoute(
  async ({ db, req, body, requireIdentity }) => {
    const identity = await requireIdentity();
    const input = await body();
    assertFormSession(readFormSession(input), req.now);
    return submitJournal(db, identity, req, input);
  },
  { mutation: true },
);

export const PUT = publicJsonRoute(
  async ({ db, req, body, requireIdentity }) => {
    const identity = await requireIdentity();
    const input = await body();
    assertFormSession(readFormSession(input), req.now);
    return editJournal(db, identity, req, input);
  },
  { mutation: true },
);
