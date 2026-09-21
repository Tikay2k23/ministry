'use client';

import { Camera, Check, ImageUp, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { shrinkImage, uploadApi, type ApiResult } from '../_lib/public-api';

/**
 * The photo of a written journal, on the public journal page (docs/02 §4 "Journal proof").
 *
 * Two ways in, because both matter on a phone: the camera, and the pictures already on the device.
 * Neither is forced — `capture` is only on the camera button, so someone who photographed their
 * journal this morning can still choose it.
 *
 * The photo is sent as soon as it is chosen, so the wait happens while the member is still reading
 * the page rather than after they press send. Until the journal is sent it is only `pending`, and
 * the cleanup job removes it if they never finish.
 */

export interface ProofState {
  attachmentId: string | null;
  uploading: boolean;
}

interface Uploaded {
  attachmentId: string;
  width: number;
  height: number;
  bytes: number;
}

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

export function ProofUpload({
  required,
  withSession,
  journalDate,
  error,
  onChange,
}: {
  required: boolean;
  /** The page's form session, refreshed automatically if this one has gone stale. */
  withSession: <T>(call: (formSession: string) => Promise<ApiResult<T>>) => Promise<ApiResult<T>>;
  journalDate: string;
  error?: string[];
  onChange: (state: ProofState) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  // Held in state, not a ref: the retry button reads it while rendering.
  const [lastFile, setLastFile] = useState<File | null>(null);

  // The preview is an object URL: release it when it is replaced or the page moves on.
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  async function send(file: File) {
    if (file.size > MAX_BYTES) {
      setMessage('Please choose an image smaller than 5 MB.');
      return;
    }
    setLastFile(file);
    setBusy(true);
    setMessage(null);
    setUploaded(null);
    onChange({ attachmentId: null, uploading: true });

    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setFileName(file.name || 'journal-photo');

    const shrunk = await shrinkImage(file);
    const result = await withSession((formSession) => {
      const body = new FormData();
      body.append('file', shrunk, 'journal-photo.webp');
      body.append('formSession', formSession);
      body.append('journalDate', journalDate);
      return uploadApi<Uploaded>('/api/public/journal/proof', body);
    });
    setBusy(false);
    if (result.ok) {
      setUploaded(result.data);
      onChange({ attachmentId: result.data.attachmentId, uploading: false });
    } else {
      setMessage(result.error.fieldErrors?.file?.[0] ?? result.error.message);
      onChange({ attachmentId: null, uploading: false });
    }
  }

  function clear() {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setFileName(null);
    setUploaded(null);
    setMessage(null);
    setLastFile(null);
    if (cameraInput.current) cameraInput.current.value = '';
    if (galleryInput.current) galleryInput.current.value = '';
    onChange({ attachmentId: null, uploading: false });
  }

  const describedBy = message || error?.length ? 'proof-error' : 'proof-hint';

  return (
    <section aria-labelledby="proof-heading" className="space-y-3 rounded-xl border border-line bg-ground/40 p-4">
      <div>
        <h2 id="proof-heading" className="text-[17px] font-semibold">
          Journal Proof {required && <span className="text-error">*</span>}
        </h2>
        <p id="proof-hint" className="text-muted">
          Upload a clear photo of your written journal as proof of today’s journal.
        </p>
      </div>

      {/* Two inputs so the camera button can ask for the camera without taking away the gallery. */}
      <input ref={cameraInput} type="file" accept={ACCEPT} capture="environment" className="sr-only" aria-hidden tabIndex={-1}
        onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
      <input ref={galleryInput} type="file" accept={ACCEPT} className="sr-only" aria-hidden tabIndex={-1}
        onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />

      {preview && (
        <figure className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a served image */}
          <img src={preview} alt="The photo you chose of your written journal" className="max-h-72 w-full rounded-xl border border-line object-contain" />
          <figcaption className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-muted">{fileName}</span>
            {busy ? (
              <span className="flex shrink-0 items-center gap-1.5 text-muted">
                <Loader2 aria-hidden className="size-4 animate-spin" /> Sending…
              </span>
            ) : uploaded ? (
              <span className="flex shrink-0 items-center gap-1.5 font-medium text-brand-deep">
                <Check aria-hidden className="size-4" /> Ready to submit
              </span>
            ) : null}
          </figcaption>
        </figure>
      )}

      {(message || error?.length) && (
        <div id="proof-error">
          <Alert tone="error">{message ?? error?.[0]}</Alert>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="lg"
          variant={preview ? 'secondary' : 'primary'}
          className="flex-1"
          disabled={busy}
          aria-describedby={describedBy}
          onClick={() => cameraInput.current?.click()}
        >
          <Camera aria-hidden className="size-5" /> {preview ? 'Replace' : 'Take photo'}
        </Button>
        <Button type="button" size="lg" variant="secondary" className="flex-1" disabled={busy} onClick={() => galleryInput.current?.click()}>
          <ImageUp aria-hidden className="size-5" /> {preview ? 'Choose another' : 'Choose photo'}
        </Button>
        {preview && !busy && (
          <Button type="button" size="lg" variant="ghost" className="w-full" onClick={clear}>
            <Trash2 aria-hidden className="size-5" /> Remove photo
          </Button>
        )}
      </div>

      {message && lastFile && !busy && (
        <Button type="button" size="lg" variant="secondary" className="w-full" onClick={() => void send(lastFile)}>
          Try again
        </Button>
      )}

      <p className="text-sm text-muted">JPG, PNG or WebP · Max 5 MB</p>
    </section>
  );
}
