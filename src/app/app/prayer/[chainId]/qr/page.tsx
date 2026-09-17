import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PrintButton } from '@/components/qr/print-button';
import { parseQrLayout, QrLayoutPicker, QrPrintSheet, qrSvg } from '@/components/qr/qr-print';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { getChainDetail } from '@/server/modules/prayer/chains.service';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export const metadata: Metadata = { title: 'Prayer chain QR code' };

/** A prayer chain's public page as a poster, card or table tent (docs/04 A27): for the prayer room. */
export default async function ChainQrPage({ params, searchParams }: { params: Promise<{ chainId: string }>; searchParams: Promise<{ layout?: string }> }) {
  const { chainId } = await params;
  if (!z.uuid().safeParse(chainId).success) notFound();
  const { ctx } = await requirePortal();
  const layout = parseQrLayout((await searchParams).layout);

  let detail: Awaited<ReturnType<typeof getChainDetail>>;
  try {
    detail = await getChainDetail(getDb(), ctx, chainId);
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 print:hidden">
        <PageHeader
          back={{ href: `/app/prayer/${chainId}/setup`, label: 'Schedule & setup' }}
          title={`${detail.chain.name} QR code`}
          description="People scan it to see the chain and find their own slot. It never shows contact details."
          actions={<PrintButton />}
        />
        <QrLayoutPicker current={layout} hrefFor={(l) => `/app/prayer/${chainId}/qr?layout=${l}`} />
      </div>
      <QrPrintSheet
        layout={layout}
        face={{
          title: detail.chain.name,
          subtitle: 'Prayer Chain',
          instruction: 'Scan to find your prayer slot',
          url: detail.publicUrl,
          svg: await qrSvg(detail.publicUrl),
        }}
      />
    </div>
  );
}
