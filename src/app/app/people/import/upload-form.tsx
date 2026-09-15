'use client';

import { FileUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function UploadForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/import/people', { method: 'POST', body: new FormData(event.currentTarget) });
      const body = (await response.json()) as {
        data?: { jobId: string };
        error?: { message: string; fieldErrors?: Record<string, string[]> };
      };
      if (body.data) {
        router.push(`/app/people/import/${body.data.jobId}`);
        return;
      }
      setError(body.error?.fieldErrors?.file?.join(' ') ?? body.error?.message ?? 'Upload failed.');
    } catch {
      setError('Upload failed. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-1.5">
        <label htmlFor="file" className="block text-sm font-medium">
          CSV file (up to 5 MB)
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-ground"
        />
      </div>
      <Button type="submit" disabled={pending}>
        <FileUp aria-hidden className="size-4" />
        {pending ? 'Checking your file…' : 'Upload and preview'}
      </Button>
    </form>
  );
}
