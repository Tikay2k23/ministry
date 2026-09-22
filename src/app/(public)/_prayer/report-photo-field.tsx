'use client';

import { Camera, Check, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { Alert } from '@/components/ui/alert';
import { uploadApi } from '../_lib/public-api';
import {
  fileSize,
  PHOTO_ACCEPT,
  usePhotoUpload,
  type PhotoState,
  type UploadedPhoto,
} from '../_lib/use-photo-upload';
import type { SlotActor } from './slot-card';

/**
 * The photo someone shares with their prayer report (docs/04 P7). Two ways in, because both matter
 * on a phone: the camera, and the pictures already on the device. Neither is forced — `capture` is
 * only on the camera input, so someone who photographed their Bible this morning can still choose
 * it from the gallery.
 */
export function ReportPhotoField({
  actor,
  required,
  formSession,
  error,
  onChange,
}: {
  actor: SlotActor;
  required: boolean;
  /** The page's form session, which the server checks so a script cannot post straight here. */
  formSession: string;
  error?: string[];
  onChange: (state: PhotoState) => void;
}) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const photo = usePhotoUpload({
    fileLabel: 'prayer-photo',
    onChange,
    send: (image) => {
      const body = new FormData();
      body.append('photo', image, 'prayer-photo.webp');
      body.append('formSession', formSession);
      for (const [key, value] of Object.entries(actor)) body.append(key, String(value));
      return uploadApi<UploadedPhoto>('/api/public/prayer/report/photo', body);
    },
  });

  const problem = photo.message ?? error?.[0];

  return (
    <section
      aria-labelledby="prayer-photo-heading"
      className="space-y-3 rounded-xl border border-line bg-ground/40 p-4"
    >
      <div>
        <h3 id="prayer-photo-heading" className="text-[17px] font-semibold">
          Prayer photo {required && <span className="text-error">*</span>}
        </h3>
        <p id="prayer-photo-hint" className="text-muted">
          A picture from your prayer time, shared with your report.
        </p>
      </div>

      {/* Two inputs so the camera button can ask for the camera without taking away the gallery. */}
      <input
        ref={cameraInput}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => e.target.files?.[0] && void photo.choose(e.target.files[0])}
      />
      <input
        ref={galleryInput}
        type="file"
        accept={PHOTO_ACCEPT}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => e.target.files?.[0] && void photo.choose(e.target.files[0])}
      />

      {photo.preview ? (
        <figure className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a served image */}
          <img
            src={photo.preview}
            alt="The photo you chose from your prayer time"
            className="size-20 shrink-0 rounded-lg border border-line object-cover"
          />
          <figcaption className="min-w-0 flex-1 space-y-1">
            <p className="truncate font-medium">{photo.fileName}</p>
            {photo.busy ? (
              <p className="flex items-center gap-1.5 text-base text-muted">
                <Loader2 aria-hidden className="size-4 animate-spin" /> Sending…
              </p>
            ) : photo.uploaded ? (
              <p className="flex items-center gap-1.5 text-base text-brand-deep">
                <Check aria-hidden className="size-4" />
                {photo.chosenBytes !== null && ` ${fileSize(photo.chosenBytes)} ·`} ready to share
              </p>
            ) : null}
            {!photo.busy && (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-base">
                <button
                  type="button"
                  onClick={() => cameraInput.current?.click()}
                  className="inline-flex items-center gap-1.5 font-medium text-brand-deep underline underline-offset-2"
                >
                  <RefreshCw aria-hidden className="size-4" /> Replace
                </button>
                <button
                  type="button"
                  onClick={photo.clear}
                  className="inline-flex items-center gap-1.5 font-medium text-error underline underline-offset-2"
                >
                  <Trash2 aria-hidden className="size-4" /> Remove
                </button>
              </p>
            )}
          </figcaption>
        </figure>
      ) : (
        <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center">
          <button
            type="button"
            onClick={() => cameraInput.current?.click()}
            aria-describedby="prayer-photo-hint"
            className="inline-flex items-center gap-2 text-[17px] font-semibold text-brand-deep"
          >
            <Camera aria-hidden className="size-6" /> Take a photo
          </button>
          <button
            type="button"
            onClick={() => galleryInput.current?.click()}
            className="text-base text-muted underline underline-offset-2"
          >
            or choose one from this phone
          </button>
          <p className="pt-1 text-sm text-muted">JPG, PNG or WebP · up to 5 MB</p>
        </div>
      )}

      {problem && (
        <Alert tone="error">
          {problem}
          {photo.lastFile && !photo.busy && (
            <button
              type="button"
              onClick={photo.retry}
              className="ml-2 font-medium underline underline-offset-2"
            >
              Try again
            </button>
          )}
        </Alert>
      )}
    </section>
  );
}
