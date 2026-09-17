import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/qr/print-button';
import { parseQrLayout, QrLayoutPicker, QrPrintSheet, qrSvg } from '@/components/qr/qr-print';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { getLeaderJournalCode } from '@/server/modules/public/entry-codes.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';
import { RotateCodeButton } from './qr-actions';

export const metadata: Metadata = { title: 'Journal QR code' };

/** A leader's journal QR code as a card, table tent or poster (docs/04 A9, A27). */
export default async function JournalQrPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ layout?: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePortal();
  const layout = parseQrLayout((await searchParams).layout);

  let code;
  try {
    code = await getLeaderJournalCode(getDb(), ctx, id);
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 print:hidden">
        <PageHeader
          back={{ href: `/app/people/${id}`, label: code.leaderName }}
          title="Journal QR code"
          description="Print it or show it on your phone. Scanning it opens the Daily Journal with this leader already chosen. It gives no access to anyone’s information."
          actions={
            <>
              <PrintButton />
              <RotateCodeButton personId={id} />
            </>
          }
        />
        <QrLayoutPicker current={layout} hrefFor={(l) => `/app/people/${id}/qr?layout=${l}`} />
      </div>
      <QrPrintSheet
        layout={layout}
        face={{ title: 'Daily Journal', subtitle: `with ${code.leaderName}`, instruction: 'Scan with your phone camera', url: code.url, svg: await qrSvg(code.url) }}
      />
    </div>
  );
}
