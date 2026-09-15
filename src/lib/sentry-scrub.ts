import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

/**
 * Privacy scrubbing for Sentry events, in the browser and on the server (docs/02 §8.1). Sentry
 * never receives cookies, headers, request bodies, query strings or IP addresses, nor the codes
 * and secrets that public links carry in their path (QR codes, personal links, prayer action
 * links). Database error messages lose the parameter values Drizzle appends to them.
 */

const LINK_WITH_SECRET = /\/(j|k|a|pray)\/[^/?#]+/g;

export function scrubUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? '';
  return withoutQuery.replace(LINK_WITH_SECRET, '/$1/[redacted]');
}

export function scrubText(text: string): string {
  return text.replace(/\bparams: [\s\S]*$/, 'params: [redacted]');
}

/** The fields error and transaction events share, which is everything the scrubbing touches. */
type ScrubbableEvent = Pick<ErrorEvent, 'request' | 'user' | 'transaction' | 'message' | 'exception'>;

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.env;
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
  }
  if (event.user) event.user = event.user.id === undefined ? undefined : { id: event.user.id };
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Console output can contain anything; our own logs already reach the log drain.
  if (breadcrumb.category === 'console') return null;
  if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
  const data = breadcrumb.data;
  if (data) {
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = scrubUrl(data[key]);
    }
  }
  return breadcrumb;
}
