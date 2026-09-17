import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PrintButton } from '@/components/qr/print-button';
import { QrCard, qrSvg } from '@/components/qr/qr-print';
import { PageHeader } from '@/components/ui/page-header';
import { isAppError } from '@/server/errors';
import { branchQrCards } from '@/server/modules/public/qr-codes.service';
import { hasGlobal } from '@/server/policy/can';
import { requirePortal } from '@/server/next/context';
import { getDb } from '@/server/next/db';

export const metadata: Metadata = { title: 'Branch QR cards' };

const PER_PAGE = 4;

/** Every leader's journal card in one branch, four to an A4 page, to cut out (docs/04 A27). */
export default async function BranchQrCardsPage({ searchParams }: { searchParams: Promise<{ personId?: string }> }) {
  const { ctx } = await requirePortal();
  if (!hasGlobal(ctx, 'links.manage')) notFound();
  const { personId } = await searchParams;
  if (!z.uuid().safeParse(personId).success) notFound();

  let branch: Awaited<ReturnType<typeof branchQrCards>>;
  try {
    branch = await branchQrCards(getDb(), ctx, { personId });
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const faces = await Promise.all(
    branch.cards.map(async (card) => ({
      key: card.personId,
      face: { title: 'Daily Journal', subtitle: `with ${card.name}`, instruction: 'Scan with your phone camera', url: card.url, svg: await qrSvg(card.url) },
    })),
  );
  const pages = Array.from({ length: Math.ceil(faces.length / PER_PAGE) }, (_, i) => faces.slice(i * PER_PAGE, (i + 1) * PER_PAGE));

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          back={{ href: '/app/admin/qr', label: 'QR codes' }}
          title={`${branch.branchName}’s branch`}
          description={
            faces.length === 0
              ? 'No leader in this branch is marked as receiving new people yet.'
              : `${faces.length === 1 ? '1 card' : `${faces.length} cards`}, four to a page. Print on A4 and cut along the edges.`
          }
          actions={faces.length > 0 && <PrintButton label="Print cards" />}
        />
      </div>
      {pages.map((page, index) => (
        <section key={index} className="grid gap-6 sm:grid-cols-2 print:grid-cols-2 print:gap-4 print:break-after-page">
          {page.map(({ key, face }) => (
            <QrCard key={key} face={face} />
          ))}
        </section>
      ))}
    </div>
  );
}
