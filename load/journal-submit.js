/**
 * k6: members sending their daily journal (docs/07 §7 "Performance", M5.5).
 *
 *   npm run db:seed:load -- --allow-postgres
 *   npm run db:load-keys -- --allow-postgres --count=3000 > load/keys.json
 *   k6 run -e BASE_URL=https://staging.example.org load/journal-submit.js
 *
 * Each virtual user is a different person with a remembered device, which is what the ministry's
 * members actually are after their first journal. Submissions are limited per person (ten a
 * minute), never per address, so this needs no exception to the rate limits.
 *
 * Target (docs/01): 50 submissions a second for 10 minutes, submit round-trip p95 ≤ 800 ms.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const RATE = Number(__ENV.RATE || 50);
const MINUTES = Number(__ENV.MINUTES || 10);

const keys = new SharedArray('device keys', () => JSON.parse(open('./keys.json')));

const submitDuration = new Trend('journal_submit_ms', true);
const submitFailures = new Rate('journal_submit_failed');

export const options = {
  scenarios: {
    submits: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: `${MINUTES}m`,
      preAllocatedVUs: Math.ceil(RATE * 4),
      maxVUs: Math.ceil(RATE * 12),
    },
  },
  thresholds: {
    // docs/01: submit round-trip p95 ≤ 800 ms of server time.
    'journal_submit_ms': ['p(95)<800'],
    'journal_submit_failed': ['rate<0.01'],
    'http_req_failed': ['rate<0.01'],
  },
};

export default function sendJournal() {
  const who = keys[Math.floor(Math.random() * keys.length)];
  const jar = http.cookieJar();
  jar.set(BASE, 'gt_pk', who.key);
  jar.set(BASE, '__Host-gt_pk', who.key); // production cookie name

  // 1. Open the journal: this is also where the form session comes from.
  const opened = http.get(`${BASE}/api/public/journal`, { tags: { name: 'open journal' } });
  if (!check(opened, { 'journal opened': (r) => r.status === 200 })) {
    submitFailures.add(1);
    return;
  }
  const state = opened.json('data');
  if (!state || !state.formSession || !state.participant) {
    submitFailures.add(1);
    return;
  }

  // 2. People take a moment to write. The form also refuses anything sent within two seconds.
  sleep(3 + Math.random() * 4);

  const answers = {};
  for (const field of state.participant.form.fields) {
    if (field.type === 'long_text' || field.type === 'short_text') answers[field.key] = 'Thankful for today, and for the people walking with me.';
    else if (field.type === 'scripture_ref') answers[field.key] = 'Psalm 23';
    else if (field.type === 'yes_no') answers[field.key] = true;
    else if (field.type === 'number') answers[field.key] = 1;
  }

  const submitted = http.post(
    `${BASE}/api/public/journal`,
    JSON.stringify({
      idempotencyKey: `k6-${who.personId}-${state.today}-${__ITER}`,
      formVersionId: state.participant.form.versionId,
      journalDate: state.today,
      answers,
      formSession: state.formSession,
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'submit journal' } },
  );

  submitDuration.add(submitted.timings.duration);
  const ok = check(submitted, {
    // A person who has already journalled today gets a conflict: that is correct behaviour, not a failure.
    'journal accepted': (r) => r.status === 200 || r.status === 409,
  });
  submitFailures.add(!ok);
}
