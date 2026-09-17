/**
 * k6: leaders using the portal (docs/07 §7 "Performance", M5.5).
 *
 *   k6 run -e BASE_URL=https://staging.example.org -e SESSION="<cookie>" load/portal-browse.js
 *
 * The portal needs a signed-in session, and sign-in links are deliberately limited, so this reuses
 * one session rather than creating hundreds: sign in to staging in a browser, copy the whole
 * `gentouch.session_token=…` cookie, and pass it as SESSION. What is being measured is server time
 * per page at 50,000 people, not the sign-in flow.
 *
 * Target (docs/01): dashboard and list pages p95 ≤ 800 ms of server time, 200 concurrent users.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const SESSION = __ENV.SESSION;
const USERS = Number(__ENV.USERS || 200);
const MINUTES = Number(__ENV.MINUTES || 5);

if (!SESSION) throw new Error('Set SESSION to a signed-in session cookie, e.g. -e SESSION="gentouch.session_token=…"');

const pageTime = new Trend('portal_page_ms', true);

export const options = {
  scenarios: {
    leaders: { executor: 'ramping-vus', startVUs: 10, stages: [{ duration: '1m', target: USERS }, { duration: `${MINUTES}m`, target: USERS }, { duration: '30s', target: 0 }] },
  },
  thresholds: {
    'portal_page_ms': ['p(95)<800'],
    'http_req_failed': ['rate<0.01'],
  },
};

// What a leader's ten minutes actually looks like: the dashboard, today's journals, the review
// queue, their people, and a follow-up list.
const PAGES = ['/app', '/app/journal', '/app/journal/review', '/app/people', '/app/follow-ups', '/app/reports'];

export default function browsePortal() {
  for (const path of PAGES) {
    const response = http.get(`${BASE}${path}`, {
      headers: { Cookie: SESSION },
      redirects: 0,
      tags: { name: path },
    });
    pageTime.add(response.timings.duration);
    check(response, {
      [`${path} answered`]: (r) => r.status === 200,
      [`${path} stayed signed in`]: (r) => r.status !== 302 && r.status !== 307,
    });
    sleep(1 + Math.random() * 3);
  }
}
