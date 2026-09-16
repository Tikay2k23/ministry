import type { Metadata } from 'next';
import { PrayerChainApp } from './prayer-chain-app';

export const metadata: Metadata = { title: 'Prayer Chain' };

/** A prayer chain's QR code (docs/04 P6). The code only shows the chain; it gives no access to anyone’s information. */
export default async function PrayerChainPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PrayerChainApp code={code} />;
}
