import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/qr/print-button';
import { parseQrLayout, QrLayoutPicker, QrPrintSheet, qrSvg } from '@/components/qr/qr-print';
import { PageHeader } from '@/components/ui/page-header';
import { getGeneralQrCode } from '@/server/modules/public/qr-codes.service';
import { hasGlobal } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export const metadata: Metadata = { title: 'Daily Journal QR code' };

/** The general journal code, for the church entrance or a slide (docs/04 A27). */
export default async function GeneralQrPage({ searchParams }: { searchParams: Promise<{ layout?: string }> }) {
  const { ctx } = await requirePortal();
  if (!hasGlobal(ctx, 'links.manage')) notFound();
  const layout = parseQrLayout((await searchParams).layout);
  const { url } = await getGeneralQrCode(getDb(), ctx);

  return (
    <div className="space-y-6">
      <div className="space-y-4 print:hidden">
        <PageHeader
          back={{ href: '/app/admin/qr', label: 'QR codes' }}
          title="Daily Journal for everyone"
          description="People scan it, then choose their leader. New people are registered and wait for their leader to confirm them."
          actions={<PrintButton />}
        />
        <QrLayoutPicker current={layout} hrefFor={(l) => `/app/admin/qr/general?layout=${l}`} />
      </div>
      <QrPrintSheet
        layout={layout}
        face={{ title: 'Daily Journal', subtitle: 'Generation Touch Harvest International', instruction: 'Scan to send your daily journal', url, svg: await qrSvg(url) }}
      />
    </div>
  );
}
