'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Last-resort page when the root layout itself fails
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md#global-error).
 * It renders its own document without the app's stylesheet, so it carries inline brand styles.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#fafaf7',
          color: '#1f2328',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <title>Something went wrong · GenTouch</title>
        <main style={{ maxWidth: 440, margin: '0 auto', padding: '64px 20px' }}>
          <h1 style={{ fontSize: 26, lineHeight: 1.2, margin: '0 0 12px' }}>Something went wrong</h1>
          <p style={{ fontSize: 16, lineHeight: 1.5, margin: '0 0 24px' }}>
            We’re sorry — this page couldn’t load. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              height: 48,
              padding: '0 20px',
              border: 0,
              borderRadius: 8,
              background: '#1f5f24',
              color: '#ffffff',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && <p style={{ marginTop: 24, fontSize: 13, color: '#5c6370' }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
