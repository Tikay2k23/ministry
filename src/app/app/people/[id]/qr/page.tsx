import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { BrandMark } from '@/components/brand/brand-mark';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { getLeaderJournalCode } from '@/server/modules/public/entry-codes.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { PrintButton, RotateCodeButton } from './qr-actions';

export const metadata: Metadata = { title: 'Journal QR code' };

/** Printable card with a leader's journal QR code (docs/04 A9). */
export default async function JournalQrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePortal();

  let code;
  try {
    code = await getLeaderJournalCode(getDb(), ctx, id);
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  // Generated server-side from our own URL; near-black on white scans most reliably.
  const svg = await QRCode.toString(code.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1f2328', light: '#ffffff' } });
  const shortUrl = code.url.replace(/^https?:\/\//, '');

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          back={{ href: `/app/people/${id}`, label: code.leaderName }}
          title="Journal QR code"
          description="Print this card or show it on your phone. Scanning it opens the Daily Journal with this leader already chosen. It gives no access to anyone’s information."
          actions={
            <>
              <PrintButton />
              <RotateCodeButton personId={id} />
            </>
          }
        />
      </div>

      <article className="mx-auto max-w-sm rounded-2xl border-2 border-brand-deep bg-white p-8 text-center print:mt-10 print:border">
        <BrandMark withTagline className="mb-5" />
        <h2 className="font-display text-2xl font-extrabold">Daily Journal</h2>
        <p className="text-muted">with {code.leaderName}</p>
        <div className="mx-auto my-6 w-64 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="font-medium">Scan with your phone camera</p>
        <p className="tabular mt-2 text-xs break-all text-muted">{shortUrl}</p>
      </article>
    </div>
  );
}
