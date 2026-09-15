'use client';

import { Check, CheckCircle2, Loader2, Lock } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { AnswerValue, FieldDefinition } from '@/server/modules/forms/answers';
import { callApi, newIdempotencyKey, publicInputClass, publicTextareaClass, type ApiResult } from '../_lib/public-api';

// ─── Types mirroring /api/public/journal ──────────────────────────────────────

interface CodeInfo {
  found: boolean;
  active: boolean;
  kind: 'journal_general' | 'journal_leader' | null;
  leader: { ref: string; name: string; acceptsMembers: boolean } | null;
}
interface OpenDate {
  date: string;
  label: 'today' | 'yesterday';
  received: { at: string; canEdit: boolean } | null;
}
interface Participant {
  firstName: string;
  leaderName: string | null;
  rememberedDevice: boolean;
  timezone: string;
  form: { versionId: string; fields: FieldDefinition[] };
  dates: OpenDate[];
}
interface JournalState {
  formSession: string;
  code: CodeInfo | null;
  participant: Participant | null;
  leaderMismatch: boolean;
}
interface Receipt {
  journalDate: string;
  receivedAt: string;
  timing: 'on_time' | 'late';
  revisionNo: number;
  leaderName: string | null;
  leaderChangeRequested: boolean;
}
interface LeaderChoice {
  ref: string;
  name: string;
}

type RawValue = string | boolean | string[];
type RawAnswers = Record<string, RawValue>;
type WithSession = <T>(call: (formSession: string) => Promise<ApiResult<T>>) => Promise<ApiResult<T>>;

// ─── Small helpers ────────────────────────────────────────────────────────────

const dayFormat = new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const formatDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));
const formatTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));

const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private browsing or storage full: drafts are a convenience only.
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

const draftKey = (date: string) => `gt_journal_draft_${date}`;

function readDraft(date: string): RawAnswers {
  const raw = storage.get(draftKey(date));
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as RawAnswers) : {};
  } catch {
    return {};
  }
}

/** Counts a QR scan once per browser session. */
function firstScanThisSession(code: string): boolean {
  try {
    const key = `gt_scanned_${code}`;
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

function toRawAnswers(answers: Record<string, AnswerValue>): RawAnswers {
  const raw: RawAnswers = {};
  for (const [key, answer] of Object.entries(answers)) {
    switch (answer.t) {
      case 'text':
      case 'choice':
      case 'date':
      case 'time':
        raw[key] = answer.v;
        break;
      case 'bool':
        raw[key] = answer.v;
        break;
      case 'choices':
        raw[key] = answer.v;
        break;
      case 'number':
        raw[key] = String(answer.v);
        break;
      case 'scripture':
        raw[key] = answer.v.raw;
        break;
    }
  }
  return raw;
}

function pickAnswers(fields: FieldDefinition[], answers: RawAnswers): RawAnswers {
  const picked: RawAnswers = {};
  for (const field of fields) {
    const value = answers[field.key];
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    picked[field.key] = value;
  }
  return picked;
}

// ─── App ──────────────────────────────────────────────────────────────────────

function fetchJournalState(code: string | null) {
  const params = new URLSearchParams();
  if (code) {
    params.set('code', code);
    if (firstScanThisSession(code)) params.set('scan', '1');
  }
  return callApi<JournalState>('GET', `/api/public/journal?${params.toString()}`);
}

export function JournalApp({ code }: { code: string | null }) {
  const [state, setState] = useState<JournalState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<'welcome' | 'identify' | 'register'>('welcome');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [leaderAnswer, setLeaderAnswer] = useState<'yes' | 'no' | null>(null);
  const stateRef = useRef<JournalState | null>(null);

  const apply = useCallback((result: ApiResult<JournalState>): JournalState | null => {
    if (!result.ok) {
      setLoadError(result.error.message);
      return null;
    }
    stateRef.current = result.data;
    setState(result.data);
    setLoadError(null);
    return result.data;
  }, []);

  const load = useCallback(async () => apply(await fetchJournalState(code)), [apply, code]);

  useEffect(() => {
    let cancelled = false;
    fetchJournalState(code).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply, code]);

  /** Runs a mutation with the anti-automation form session, renewing it once if it expired. */
  const withSession: WithSession = useCallback(
    async <T,>(call: (formSession: string) => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      const session = stateRef.current?.formSession ?? (await load())?.formSession;
      if (!session) return { ok: false, status: 0, error: { code: 'INTERNAL', message: 'Please reload the page and try again.' } };
      let result = await call(session);
      const reason = result.ok ? null : result.error.meta?.reason;
      if (reason === 'TOO_FAST') {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        result = await call(session);
      } else if (reason === 'FORM_SESSION') {
        const fresh = await load();
        if (fresh) result = await call(fresh.formSession);
      }
      return result;
    },
    [load],
  );

  const forget = async () => {
    await callApi('POST', '/api/public/forget', {});
    setReceipt(null);
    setLeaderAnswer(null);
    setScreen('welcome');
    await load();
  };

  if (!state) {
    return loadError ? (
      <div className="space-y-4">
        <Alert tone="error" title="We couldn’t open the journal">
          {loadError}
        </Alert>
        <Button size="lg" variant="secondary" className="w-full" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="flex items-center justify-center gap-3 py-20 text-muted">
        <Loader2 aria-hidden className="size-5 animate-spin" /> Opening your journal…
      </div>
    );
  }

  const codeNotice =
    state.code && !state.code.active ? (
      <Alert tone="warning" title={state.code.found ? 'This QR code is no longer in use' : 'We don’t recognise this QR code'}>
        You can still send your journal here. If you’re new, you can find your leader by name.
      </Alert>
    ) : null;

  const participant = state.participant;

  if (receipt && participant) {
    return <ReceiptView receipt={receipt} participant={participant} onDone={() => setReceipt(null)} />;
  }

  if (!participant) {
    return (
      <div className="space-y-6">
        {codeNotice}
        {screen === 'welcome' && (
          <Welcome codeLeader={state.code?.leader ?? null} onIdentify={() => setScreen('identify')} onRegister={() => setScreen('register')} />
        )}
        {screen === 'identify' && (
          <IdentifyForm
            withSession={withSession}
            onIdentified={() => void load()}
            onBack={() => setScreen('welcome')}
            onRegister={() => setScreen('register')}
          />
        )}
        {screen === 'register' && (
          <RegisterForm
            withSession={withSession}
            codeLeader={state.code?.leader?.acceptsMembers ? { ref: state.code.leader.ref, name: state.code.leader.name } : null}
            onRegistered={() => void load()}
            onBack={() => setScreen('welcome')}
            onIdentify={() => setScreen('identify')}
          />
        )}
      </div>
    );
  }

  const codeLeader = state.code?.leader ?? null;
  if (state.leaderMismatch && codeLeader && leaderAnswer === null) {
    return (
      <LeaderCheck
        firstName={participant.firstName}
        codeLeaderName={codeLeader.name}
        currentLeaderName={participant.leaderName}
        onAnswer={setLeaderAnswer}
      />
    );
  }

  return (
    <div className="space-y-8">
      {codeNotice}
      <JournalHome
        participant={participant}
        entryCode={state.code?.active ? code : null}
        requestLeaderChange={leaderAnswer === 'yes'}
        withSession={withSession}
        onReload={() => void load()}
        onReceipt={(r) => {
          setReceipt(r);
          void load();
        }}
      />
      <p className="text-center text-base text-muted">
        Not {participant.firstName}?{' '}
        <button type="button" onClick={() => void forget()} className="font-medium text-brand-deep underline underline-offset-2">
          Use as someone else
        </button>
      </p>
    </div>
  );
}

// ─── Screens ──────────────────────────────────────────────────────────────────

function Welcome({ codeLeader, onIdentify, onRegister }: { codeLeader: CodeInfo['leader']; onIdentify: () => void; onRegister: () => void }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-[28px] leading-tight">Daily Journal</h1>
        <p className="text-muted">Take a few quiet minutes with God today, and share what He is teaching you.</p>
      </div>
      {codeLeader && (
        <p className="rounded-xl bg-brand-leaf-tint px-4 py-3 text-brand-deep">
          You’re journaling with <strong>{codeLeader.name}</strong>’s group.
        </p>
      )}
      <div className="space-y-3">
        <Button size="lg" className="w-full" onClick={onIdentify}>
          I’ve journaled before
        </Button>
        <Button size="lg" variant="secondary" className="w-full" onClick={onRegister}>
          I’m new here
        </Button>
      </div>
    </div>
  );
}

function IdentifyForm({
  withSession,
  onIdentified,
  onBack,
  onRegister,
}: {
  withSession: WithSession;
  onIdentified: () => void;
  onBack: () => void;
  onRegister: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<ReactNode>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [remember, setRemember] = useState(true);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setMessage(null);
      const result = await withSession((formSession) =>
        callApi<{ result: 'identified' | 'not_confirmed' | 'use_personal_link' }>('POST', '/api/public/identify', {
          phone: String(form.get('phone') ?? ''),
          firstName: String(form.get('firstName') ?? ''),
          rememberDevice: remember,
          formSession,
        }),
      );
      if (!result.ok) {
        setFieldErrors(result.error.fieldErrors ?? {});
        setMessage(result.error.message);
        return;
      }
      setFieldErrors({});
      if (result.data.result === 'identified') {
        onIdentified();
      } else if (result.data.result === 'use_personal_link') {
        setMessage('Please ask your leader to send you your personal journal link.');
      } else {
        setMessage(
          <>
            We couldn’t find you with that mobile number and first name. Please check both — or{' '}
            <button type="button" onClick={onRegister} className="font-semibold underline underline-offset-2">
              register as new
            </button>
            .
          </>,
        );
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-[28px] leading-tight">Welcome back!</h1>
        <p className="text-muted">Enter the mobile number and first name you journal with.</p>
      </div>
      <TextInput label="Mobile number" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" required errors={fieldErrors.phone} />
      <TextInput label="First name" name="firstName" autoComplete="given-name" required errors={fieldErrors.firstName} />
      <CheckboxField checked={remember} onChange={setRemember} hint="Untick this on a shared or borrowed phone.">
        Remember me on this phone
      </CheckboxField>
      {message && <Alert tone="warning">{message}</Alert>}
      <div className="space-y-3">
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Checking…' : 'Continue'}
        </Button>
        <Button size="lg" variant="ghost" className="w-full" onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  );
}

function RegisterForm({
  withSession,
  codeLeader,
  onRegistered,
  onBack,
  onIdentify,
}: {
  withSession: WithSession;
  codeLeader: LeaderChoice | null;
  onRegistered: () => void;
  onBack: () => void;
  onIdentify: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<ReactNode>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [leader, setLeader] = useState<LeaderChoice | null>(codeLeader);
  const [birthYear, setBirthYear] = useState('');
  const [consent, setConsent] = useState(false);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [remember, setRemember] = useState(true);
  const [currentYear] = useState(() => new Date().getFullYear());
  const isMinor = /^\d{4}$/.test(birthYear) && currentYear - Number(birthYear) < 18;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '');
    startTransition(async () => {
      setMessage(null);
      const result = await withSession((formSession) =>
        callApi<{ firstName: string; leaderName: string }>('POST', '/api/public/register', {
          firstName: text('firstName'),
          lastName: text('lastName'),
          phone: text('phone'),
          leaderRef: leader?.ref ?? '',
          birthYear,
          guardianName: isMinor ? text('guardianName') : '',
          guardianRelationship: isMinor ? text('guardianRelationship') : '',
          guardianConsent: isMinor ? guardianConsent : undefined,
          consent,
          rememberDevice: remember,
          website: text('website'),
          formSession,
        }),
      );
      if (result.ok) {
        onRegistered();
        return;
      }
      setFieldErrors(result.error.fieldErrors ?? {});
      if (result.error.meta?.reason === 'ALREADY_REGISTERED') {
        setMessage(
          <>
            It looks like you’ve journaled with us before.{' '}
            <button type="button" onClick={onIdentify} className="font-semibold underline underline-offset-2">
              Find my journal
            </button>
          </>,
        );
      } else {
        setMessage(result.error.message);
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="relative space-y-5">
      <div className="space-y-1">
        <h1 className="text-[28px] leading-tight">Welcome!</h1>
        <p className="text-muted">Tell us a little about yourself. It takes about a minute.</p>
      </div>
      <TextInput label="First name" name="firstName" autoComplete="given-name" required errors={fieldErrors.firstName} />
      <TextInput label="Last name" name="lastName" autoComplete="family-name" required errors={fieldErrors.lastName} />
      <TextInput
        label={
          <>
            Mobile number <span className="font-normal text-muted">(recommended)</span>
          </>
        }
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0917 123 4567"
        hint="So we can recognise you next time. We never share it."
        errors={fieldErrors.phone}
      />
      <LeaderSearch value={leader} onChange={setLeader} errors={fieldErrors.leaderRef} />
      <TextInput
        label={
          <>
            Year you were born <span className="font-normal text-muted">(optional)</span>
          </>
        }
        name="birthYear"
        inputMode="numeric"
        maxLength={4}
        value={birthYear}
        onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ''))}
        errors={fieldErrors.birthYear}
      />
      {isMinor && (
        <div className="space-y-4 rounded-xl border border-line-strong bg-surface p-4">
          <p className="font-medium">Because you’re under 18, a parent or guardian needs to agree.</p>
          <TextInput label="Parent or guardian’s name" name="guardianName" errors={fieldErrors.guardianName} />
          <TextInput
            label={
              <>
                Relationship <span className="font-normal text-muted">(optional)</span>
              </>
            }
            name="guardianRelationship"
            placeholder="e.g. Mother"
          />
          <CheckboxField checked={guardianConsent} onChange={setGuardianConsent}>
            My parent or guardian agrees to me joining the Daily Journal.
          </CheckboxField>
        </div>
      )}
      <CheckboxField checked={consent} onChange={setConsent} errors={fieldErrors.consent}>
        I agree to the{' '}
        <a href="/privacy" target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
          privacy notice
        </a>
        . My leaders and pastors will be able to see my journal so they can pray for me and care for me.
      </CheckboxField>
      <CheckboxField checked={remember} onChange={setRemember} hint="Untick this on a shared or borrowed phone.">
        Remember me on this phone
      </CheckboxField>
      {/* Honeypot: hidden from people, often filled in by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {message && <Alert tone="error">{message}</Alert>}
      <div className="space-y-3">
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Saving…' : 'Continue'}
        </Button>
        <Button size="lg" variant="ghost" className="w-full" onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  );
}

function LeaderSearch({ value, onChange, errors }: { value: LeaderChoice | null; onChange: (leader: LeaderChoice | null) => void; errors?: string[] }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; leaders: { ref: string; name: string; hint: string | null }[] }>({ query: '', leaders: [] });
  const trimmed = query.trim();
  const invalid = Boolean(errors?.length);

  useEffect(() => {
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await callApi<{ leaders: { ref: string; name: string; hint: string | null }[] }>(
        'GET',
        `/api/public/leaders?q=${encodeURIComponent(trimmed)}`,
      );
      if (!cancelled) setFound({ query: trimmed, leaders: result.ok ? result.data.leaders : [] });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  if (value) {
    return (
      <div className="space-y-1.5">
        <p className="font-medium">Your leader</p>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-deep/30 bg-brand-leaf-tint px-4 py-3">
          <span className="font-semibold text-brand-deep">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} className="text-base text-brand-deep underline underline-offset-2">
            Change
          </button>
        </div>
      </div>
    );
  }

  const settled = found.query === trimmed && trimmed.length >= 2;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block font-medium">
        Who is your leader?
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type your leader’s first name"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : `${id}-hint`}
        className={publicInputClass}
      />
      {!invalid && (
        <p id={`${id}-hint`} className="text-base text-muted">
          Not sure? Ask the person who invited you.
        </p>
      )}
      {trimmed.length >= 2 && !settled && <p className="text-base text-muted">Searching…</p>}
      {settled && found.leaders.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line-strong bg-surface">
          {found.leaders.map((leader) => (
            <li key={leader.ref}>
              <button
                type="button"
                onClick={() => {
                  onChange({ ref: leader.ref, name: leader.name });
                  setQuery('');
                }}
                className="flex w-full flex-col items-start px-4 py-3 text-left hover:bg-ground"
              >
                <span className="font-medium">{leader.name}</span>
                {leader.hint && <span className="text-base text-muted">{leader.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {settled && found.leaders.length === 0 && <p className="text-base text-muted">We couldn’t find a leader with that name.</p>}
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-base text-error">
          {errors!.join(' ')}
        </p>
      )}
    </div>
  );
}

function LeaderCheck({
  firstName,
  codeLeaderName,
  currentLeaderName,
  onAnswer,
}: {
  firstName: string;
  codeLeaderName: string;
  currentLeaderName: string | null;
  onAnswer: (answer: 'yes' | 'no') => void;
}) {
  return (
    <div className="space-y-5">
      <h1 className="text-[28px] leading-tight">Hello, {firstName}!</h1>
      <p>
        This QR code belongs to <strong>{codeLeaderName}</strong>
        {currentLeaderName ? (
          <>
            , but our records show <strong>{currentLeaderName}</strong> as your leader
          </>
        ) : null}
        .
      </p>
      <p className="font-semibold">Is {codeLeaderName} your leader now?</p>
      <div className="space-y-3">
        <Button size="lg" className="w-full" onClick={() => onAnswer('yes')}>
          Yes, {codeLeaderName} is my leader now
        </Button>
        <Button size="lg" variant="secondary" className="w-full" onClick={() => onAnswer('no')}>
          No{currentLeaderName ? `, it’s still ${currentLeaderName}` : ''}
        </Button>
      </div>
      <p className="text-base text-muted">Either way, you can send your journal right after this.</p>
    </div>
  );
}

function JournalHome({
  participant,
  entryCode,
  requestLeaderChange,
  withSession,
  onReload,
  onReceipt,
}: {
  participant: Participant;
  entryCode: string | null;
  requestLeaderChange: boolean;
  withSession: WithSession;
  onReload: () => void;
  onReceipt: (receipt: Receipt) => void;
}) {
  const fallback =
    participant.dates.find((d) => d.label === 'today' && !d.received) ??
    participant.dates.find((d) => !d.received) ??
    participant.dates[participant.dates.length - 1]!;
  const [selectedDate, setSelectedDate] = useState(fallback.date);
  const [editing, setEditing] = useState<{ date: string; answers: RawAnswers } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [openingEdit, startEdit] = useTransition();
  const current = participant.dates.find((d) => d.date === selectedDate) ?? fallback;
  const isEditing = editing?.date === current.date;

  const beginEdit = () =>
    startEdit(async () => {
      setEditError(null);
      const result = await callApi<{ answers: Record<string, AnswerValue> }>('GET', `/api/public/journal/entry?date=${current.date}`);
      if (!result.ok) {
        setEditError(result.error.message);
        return;
      }
      setEditing({ date: current.date, answers: toRawAnswers(result.data.answers) });
    });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] leading-tight">Hello, {participant.firstName}!</h1>
        {participant.leaderName && <p className="text-muted">Leader: {participant.leaderName}</p>}
      </div>

      {participant.dates.length > 1 && (
        <div role="tablist" aria-label="Which day" className="grid grid-cols-2 gap-1 rounded-xl bg-ink/5 p-1">
          {participant.dates.map((d) => (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={d.date === current.date}
              onClick={() => {
                setSelectedDate(d.date);
                setEditing(null);
              }}
              className={cn(
                'flex h-11 items-center justify-center gap-1.5 rounded-lg text-base font-medium',
                d.date === current.date ? 'bg-surface text-ink shadow-sm' : 'text-muted',
              )}
            >
              {d.label === 'today' ? 'Today' : 'Yesterday'}
              {d.received && <Check aria-label="received" className="size-4 text-brand-deep" />}
            </button>
          ))}
        </div>
      )}

      {!participant.rememberedDevice && (
        <Alert tone="info">You’re using this phone just for now. Next time, we’ll ask who you are again.</Alert>
      )}

      {current.received && !isEditing ? (
        <div className="space-y-4 rounded-2xl border border-brand-deep/20 bg-brand-leaf-tint p-5">
          <p className="flex items-center gap-2 font-semibold text-brand-deep">
            <CheckCircle2 aria-hidden className="size-6" /> Journal received
          </p>
          <p>
            Your journal for {current.label === 'today' ? 'today' : 'yesterday'} arrived at{' '}
            {formatTime(current.received.at, participant.timezone)}. Thank you!
          </p>
          {current.received.canEdit && (
            <Button variant="secondary" size="lg" className="w-full" onClick={beginEdit} disabled={openingEdit}>
              {openingEdit ? 'Opening…' : 'Edit my journal'}
            </Button>
          )}
          {editError && <Alert tone="error">{editError}</Alert>}
        </div>
      ) : (
        <QuestionsForm
          key={`${current.date}-${isEditing ? 'edit' : 'new'}`}
          participant={participant}
          date={current.date}
          label={current.label}
          mode={isEditing ? 'edit' : 'new'}
          initial={isEditing ? editing.answers : null}
          entryCode={entryCode}
          requestLeaderChange={requestLeaderChange}
          withSession={withSession}
          onReload={onReload}
          onReceipt={(receipt) => {
            setEditing(null);
            onReceipt(receipt);
          }}
          onCancel={isEditing ? () => setEditing(null) : undefined}
        />
      )}
    </div>
  );
}

function QuestionsForm({
  participant,
  date,
  label,
  mode,
  initial,
  entryCode,
  requestLeaderChange,
  withSession,
  onReload,
  onReceipt,
  onCancel,
}: {
  participant: Participant;
  date: string;
  label: 'today' | 'yesterday';
  mode: 'new' | 'edit';
  initial: RawAnswers | null;
  entryCode: string | null;
  requestLeaderChange: boolean;
  withSession: WithSession;
  onReload: () => void;
  onReceipt: (receipt: Receipt) => void;
  onCancel?: () => void;
}) {
  const fields = participant.form.fields;
  // Drafts stay on remembered devices only — never on a shared phone.
  const keepDraft = participant.rememberedDevice && mode === 'new';
  const [answers, setAnswers] = useState<RawAnswers>(() => initial ?? (keepDraft ? readDraft(date) : {}));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const idempotencyKey = useRef<string | null>(null);

  const update = (key: string, value: RawValue) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    if (keepDraft) storage.set(draftKey(date), JSON.stringify(next));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      setMessage(null);
      // One key per journal attempt: a retry after a lost connection can't create a second entry.
      idempotencyKey.current ??= newIdempotencyKey();
      const key = idempotencyKey.current;
      const result = await withSession((formSession) =>
        callApi<Receipt>(mode === 'new' ? 'POST' : 'PUT', '/api/public/journal', {
          idempotencyKey: key,
          formVersionId: participant.form.versionId,
          journalDate: date,
          answers: pickAnswers(fields, answers),
          formSession,
          ...(mode === 'new' ? { entryCode: entryCode ?? undefined, requestLeaderChange } : {}),
        }),
      );
      if (result.ok) {
        storage.remove(draftKey(date));
        onReceipt(result.data);
        return;
      }
      const { error } = result;
      if (error.code === 'VALIDATION_ERROR') {
        setFieldErrors(error.fieldErrors ?? {});
        if (error.fieldErrors?._) {
          setMessage('The questions have changed, so we reloaded them. Your answers are kept where possible.');
          onReload();
        } else {
          setMessage(error.message);
        }
        return;
      }
      setFieldErrors({});
      setMessage(error.message);
      const reason = error.meta?.reason;
      if (
        error.code === 'NOT_IDENTIFIED' ||
        reason === 'ALREADY_SUBMITTED' ||
        reason === 'DAY_CLOSED' ||
        reason === 'FORM_VERSION_RETIRED' ||
        reason === 'EDIT_WINDOW_CLOSED'
      ) {
        onReload();
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-7">
      <p className="text-muted">
        {mode === 'edit' ? 'Editing your journal for ' : 'Your journal for '}
        {label === 'today' ? 'today' : 'yesterday'}, {formatDay(date)}.
        {label === 'yesterday' && mode === 'new' && ' It will show as sent late — and that’s okay.'}
      </p>
      {fields.map((field) => (
        <QuestionField
          key={field.key}
          field={field}
          value={answers[field.key]}
          errors={fieldErrors[field.key]}
          onChange={(value) => update(field.key, value)}
        />
      ))}
      {requestLeaderChange && mode === 'new' && <Alert tone="info">We’ll ask your leaders to update who your leader is.</Alert>}
      {message && <Alert tone="error">{message}</Alert>}
      <div className="space-y-3">
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            <>
              <Loader2 aria-hidden className="size-5 animate-spin" /> Sending…
            </>
          ) : mode === 'edit' ? (
            'Save changes'
          ) : (
            'Send my journal'
          )}
        </Button>
        {onCancel && (
          <Button size="lg" variant="ghost" className="w-full" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

const LONG_TEXT_TYPES = new Set(['long_text', 'reflection', 'prayer_request', 'testimony', 'gratitude']);

function QuestionField({
  field,
  value,
  errors,
  onChange,
}: {
  field: FieldDefinition;
  value: RawValue | undefined;
  errors?: string[];
  onChange: (value: RawValue) => void;
}) {
  const id = useId();
  const invalid = Boolean(errors?.length);
  const privacyNote =
    field.sensitivity === 'restricted'
      ? 'Only your direct leader and pastors can read this answer.'
      : field.sensitivity === 'confidential'
        ? 'Only your pastors can read this answer.'
        : null;
  const describedBy = cn(field.helpText && `${id}-help`, privacyNote && `${id}-privacy`, invalid && `${id}-error`) || undefined;
  const title = (
    <>
      {field.label}
      {!field.required && <span className="font-normal text-muted"> (optional)</span>}
    </>
  );
  const notes = (
    <>
      {field.helpText && (
        <p id={`${id}-help`} className="text-base text-muted">
          {field.helpText}
        </p>
      )}
      {privacyNote && (
        <p id={`${id}-privacy`} className="flex items-center gap-1.5 text-sm text-muted">
          <Lock aria-hidden className="size-3.5 shrink-0" /> {privacyNote}
        </p>
      )}
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-base text-error">
          {errors!.join(' ')}
        </p>
      )}
    </>
  );

  if (field.type === 'yes_no' || field.type === 'single_choice' || field.type === 'multi_choice') {
    const options =
      field.type === 'yes_no'
        ? [
            { key: 'yes', label: 'Yes' },
            { key: 'no', label: 'No' },
          ]
        : (field.config.options ?? []);
    const multi = field.type === 'multi_choice';
    const isChecked = (key: string) =>
      field.type === 'yes_no' ? value === (key === 'yes') : multi ? Array.isArray(value) && value.includes(key) : value === key;
    const choose = (key: string) => {
      if (field.type === 'yes_no') onChange(key === 'yes');
      else if (multi) {
        const list = Array.isArray(value) ? value : [];
        onChange(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
      } else onChange(key);
    };
    return (
      <fieldset className="space-y-2" aria-describedby={describedBy}>
        <legend className="mb-2 font-semibold">{title}</legend>
        <div className={cn('grid gap-2', field.type === 'yes_no' && 'grid-cols-2')}>
          {options.map((option) => (
            <label
              key={option.key}
              className={cn(
                'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2',
                isChecked(option.key) ? 'border-brand-deep bg-brand-leaf-tint' : 'border-line-strong bg-surface',
              )}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={`${id}-choice`}
                value={option.key}
                checked={isChecked(option.key)}
                onChange={() => choose(option.key)}
                aria-invalid={invalid || undefined}
                className="size-5 accent-brand-deep"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {notes}
      </fieldset>
    );
  }

  const text = typeof value === 'string' ? value : '';
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block font-semibold">
        {title}
      </label>
      {LONG_TEXT_TYPES.has(field.type) ? (
        <textarea
          id={id}
          rows={field.type === 'reflection' ? 6 : 4}
          value={text}
          maxLength={field.config.maxLength}
          placeholder={field.config.placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={publicTextareaClass}
        />
      ) : (
        <input
          id={id}
          type={field.type === 'date' ? 'date' : field.type === 'time' ? 'time' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          autoComplete="off"
          value={text}
          maxLength={field.type === 'scripture_ref' ? 200 : field.config.maxLength}
          placeholder={field.config.placeholder ?? (field.type === 'scripture_ref' ? 'e.g. John 3:16' : undefined)}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={publicInputClass}
        />
      )}
      {notes}
    </div>
  );
}

function ReceiptView({ receipt, participant, onDone }: { receipt: Receipt; participant: Participant; onDone: () => void }) {
  const edited = receipt.revisionNo > 1;
  return (
    <div className="space-y-5 py-4 text-center" role="status">
      <CheckCircle2 aria-hidden className="mx-auto size-16 text-brand-deep" />
      <h1 className="text-[28px] leading-tight">{edited ? 'Changes saved' : `Thank you, ${participant.firstName}!`}</h1>
      <p>
        Your journal for {formatDay(receipt.journalDate)} was {edited ? 'updated' : 'received'} at{' '}
        {formatTime(receipt.receivedAt, participant.timezone)}.
      </p>
      {receipt.timing === 'late' && !edited && (
        <p className="text-muted">It came in after the deadline, and that’s okay — thank you for not giving up.</p>
      )}
      {receipt.leaderChangeRequested && <p className="text-muted">We’ve asked your leaders to update who your leader is.</p>}
      <p className="font-display text-xl font-extrabold text-brand-deep">God bless you!</p>
      <Button size="lg" variant="secondary" className="w-full" onClick={onDone}>
        Back to my journal
      </Button>
    </div>
  );
}

// ─── Form controls ────────────────────────────────────────────────────────────

function TextInput({
  label,
  hint,
  errors,
  className,
  ...props
}: { label: ReactNode; hint?: ReactNode; errors?: string[] } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const invalid = Boolean(errors?.length);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(publicInputClass, className)}
        {...props}
      />
      {hint && !invalid && (
        <p id={`${id}-hint`} className="text-base text-muted">
          {hint}
        </p>
      )}
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-base text-error">
          {errors!.join(' ')}
        </p>
      )}
    </div>
  );
}

function CheckboxField({
  checked,
  onChange,
  children,
  hint,
  errors,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
  errors?: string[];
}) {
  const id = useId();
  const invalid = Boolean(errors?.length);
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className="mt-1 size-5 shrink-0 accent-brand-deep"
        />
        <div>
          <label htmlFor={id}>{children}</label>
          {hint && (
            <p id={`${id}-hint`} className="text-base text-muted">
              {hint}
            </p>
          )}
        </div>
      </div>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-base text-error">
          {errors!.join(' ')}
        </p>
      )}
    </div>
  );
}
