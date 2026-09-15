import type { Metadata } from 'next';
import { JournalApp } from './journal-app';

export const metadata: Metadata = { title: 'Daily Journal' };

/** The general journal link (no leader preselected). */
export default function JournalPage() {
  return <JournalApp code={null} />;
}
