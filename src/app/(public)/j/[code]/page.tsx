import type { Metadata } from 'next';
import { JournalApp } from '../journal-app';

export const metadata: Metadata = { title: 'Daily Journal' };

/** A leader's QR code (or the general code). The code only preselects the leader; it grants no access. */
export default async function JournalCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JournalApp code={code} />;
}
