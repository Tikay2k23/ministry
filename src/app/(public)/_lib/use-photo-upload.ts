'use client';

import { useEffect, useState } from 'react';
import { shrinkImage, type ApiResult } from './public-api';

/**
 * Choosing a photo on a phone and sending it straight away, shared by the journal's proof photo
 * and the prayer report's (docs/02 §4). Only the awkward parts live here — shrinking before the
 * upload, the preview object URL and releasing it, and what to say when it fails — so each page
 * can lay its own field out the way its design asks.
 *
 * The photo goes as soon as it is chosen, so the wait happens while the person is still reading
 * the page rather than after they press send.
 */

export interface UploadedPhoto {
  attachmentId: string;
  width: number;
  height: number;
  bytes: number;
}

export interface PhotoState {
  attachmentId: string | null;
  uploading: boolean;
}

const MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

/** "245 KB", the way a phone shows it. */
export function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function usePhotoUpload({
  send,
  onChange,
  fileLabel,
}: {
  /** Posts the shrunk image wherever it belongs, and returns what the server made of it. */
  send: (image: Blob) => Promise<ApiResult<UploadedPhoto>>;
  onChange: (state: PhotoState) => void;
  /** The name given to the file that is sent; the one the browser chose is never trusted. */
  fileLabel: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  /** The size of the photo they chose. What we store is smaller, which would only confuse. */
  const [chosenBytes, setChosenBytes] = useState<number | null>(null);

  // The preview is an object URL: release it when it is replaced or the page moves on.
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  async function choose(file: File) {
    if (file.size > MAX_BYTES) {
      setMessage('Please choose an image smaller than 5 MB.');
      return;
    }
    setLastFile(file);
    setChosenBytes(file.size);
    setBusy(true);
    setMessage(null);
    setUploaded(null);
    onChange({ attachmentId: null, uploading: true });

    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setFileName(file.name || fileLabel);

    const image = await shrinkImage(file);
    let result = await send(image);
    // The form guard turns away anything sent within two seconds of the page loading. Someone who
    // taps the camera the moment they finish praying is not a robot: wait, and send it again.
    if (!result.ok && result.error.meta?.reason === 'TOO_FAST') {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      result = await send(image);
    }
    setBusy(false);
    if (result.ok) {
      setUploaded(result.data);
      onChange({ attachmentId: result.data.attachmentId, uploading: false });
    } else {
      setMessage(
        result.error.fieldErrors?.file?.[0] ?? result.error.fieldErrors?.photo?.[0] ?? result.error.message,
      );
      onChange({ attachmentId: null, uploading: false });
    }
  }

  function clear() {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setFileName(null);
    setChosenBytes(null);
    setUploaded(null);
    setMessage(null);
    setLastFile(null);
    onChange({ attachmentId: null, uploading: false });
  }

  return {
    preview,
    fileName,
    chosenBytes,
    uploaded,
    busy,
    message,
    lastFile,
    choose,
    clear,
    retry: () => (lastFile ? void choose(lastFile) : undefined),
  };
}
