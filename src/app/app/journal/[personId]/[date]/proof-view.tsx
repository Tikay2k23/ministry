'use client';

import { Camera, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * The photo of a written journal, for a leader or pastor who may see it (docs/02 §4).
 *
 * Nothing is loaded until it is asked for: the link is made when this is opened, lasts a minute,
 * and the viewing is recorded. That keeps a signed link out of the page source, out of a shared
 * screenshot of the dashboard, and out of the browser history.
 */
export function ProofView({ attachmentId, personName }: { attachmentId: string; personName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/journal/proof/${attachmentId}`, { cache: 'no-store' });
    const body = (await response.json().catch(() => null)) as { data?: { url: string }; error?: { message: string } } | null;
    setLoading(false);
    if (response.ok && body?.data) setUrl(body.data.url);
    else setError(body?.error?.message ?? 'We couldn’t open that photo.');
  }, [attachmentId]);

  // The link expires: close the larger view rather than leave a broken image behind.
  useEffect(() => {
    if (!url) return;
    const timer = setTimeout(() => {
      setUrl(null);
      setFull(false);
    }, 55_000);
    return () => clearTimeout(timer);
  }, [url]);

  return (
    <div className="space-y-2">
      {error && <Alert tone="error">{error}</Alert>}

      {url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not a served asset */}
          <img
            src={url}
            alt={`${personName}’s written journal`}
            className="max-h-64 w-full cursor-zoom-in rounded-lg border border-line object-contain"
            onClick={() => setFull(true)}
          />
          <p className="text-sm text-muted">Tap the photo to see it larger. The link expires in a minute.</p>
        </>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Camera aria-hidden className="size-4" />}
          {loading ? 'Opening…' : 'Show the photo'}
        </Button>
      )}

      {full && url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${personName}’s written journal`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          onClick={() => setFull(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
          <img src={url} alt={`${personName}’s written journal, larger`} className="max-h-full max-w-full rounded-lg object-contain" />
          <Button
            variant="secondary"
            size="sm"
            className="absolute top-4 right-4"
            onClick={(event) => {
              event.stopPropagation();
              setFull(false);
            }}
          >
            <X aria-hidden className="size-4" /> Close
          </Button>
        </div>
      )}
    </div>
  );
}
