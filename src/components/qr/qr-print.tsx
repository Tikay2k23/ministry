import Link from 'next/link';
import QRCode from 'qrcode';
import { BrandMark } from '@/components/brand/brand-mark';
import { cn } from '@/lib/cn';

/**
 * Printable QR layouts (docs/04 A27): a card to hand over or keep in a Bible, a table tent for a
 * meeting table, and an A4 poster for a wall. The code only opens a page with its context (a
 * leader, a prayer chain, or the general journal); it gives no access to anyone's information.
 */

export const QR_LAYOUTS = ['card', 'tent', 'poster'] as const;
export type QrLayout = (typeof QR_LAYOUTS)[number];

const LAYOUT_LABELS: Record<QrLayout, string> = { card: 'Card', tent: 'Table tent', poster: 'Poster' };

export function parseQrLayout(value: string | string[] | undefined): QrLayout {
  const raw = Array.isArray(value) ? value[0] : value;
  return QR_LAYOUTS.find((layout) => layout === raw) ?? 'card';
}

/** Server-side SVG from our own URL: near-black on white scans most reliably, printed or on a screen. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1f2328', light: '#ffffff' } });
}

export interface QrFace {
  /** "Daily Journal", or the prayer chain's name. */
  title: string;
  /** "with Anna Lim", "Prayer Chain". */
  subtitle?: string;
  instruction: string;
  url: string;
  svg: string;
}

function QrImage({ svg, className }: { svg: string; className: string }) {
  // The SVG comes from the qrcode library and our own URL, never from what someone typed.
  return <div className={cn('mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:w-full', className)} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const shortUrl = (url: string) => url.replace(/^https?:\/\//, '');

/** One card (also used many to a page for a branch's leaders). */
export function QrCard({ face, className }: { face: QrFace; className?: string }) {
  return (
    <article className={cn('rounded-2xl border-2 border-brand-deep bg-white p-6 text-center break-inside-avoid print:border', className)}>
      <BrandMark withTagline className="mb-4" />
      <h2 className="font-display text-2xl font-extrabold">{face.title}</h2>
      {face.subtitle && <p className="text-muted">{face.subtitle}</p>}
      <QrImage svg={face.svg} className="my-5 w-52" />
      <p className="font-medium">{face.instruction}</p>
      <p className="tabular mt-2 text-xs break-all text-muted">{shortUrl(face.url)}</p>
    </article>
  );
}

function TentPanel({ face, upsideDown }: { face: QrFace; upsideDown?: boolean }) {
  return (
    <div className={cn('flex h-[128mm] flex-col items-center justify-center gap-3 px-8 text-center', upsideDown && 'rotate-180')}>
      <BrandMark withTagline />
      <h2 className="font-display text-3xl font-extrabold">{face.title}</h2>
      {face.subtitle && <p className="text-lg text-muted">{face.subtitle}</p>}
      <QrImage svg={face.svg} className="w-[62mm]" />
      <p className="text-lg font-medium">{face.instruction}</p>
    </div>
  );
}

/** Print the page, fold along the dashed line, and stand it up: both sides read the right way up. */
export function QrPrintSheet({ layout, face }: { layout: QrLayout; face: QrFace }) {
  if (layout === 'tent') {
    return (
      <div className="mx-auto w-full max-w-[190mm] rounded-2xl border border-line bg-white print:rounded-none print:border-0">
        <TentPanel face={face} upsideDown />
        <div className="relative border-t-2 border-dashed border-line-strong">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-2 text-xs text-muted print:hidden">fold here</span>
        </div>
        <TentPanel face={face} />
      </div>
    );
  }
  if (layout === 'poster') {
    return (
      <article className="mx-auto flex min-h-[260mm] w-full max-w-[190mm] flex-col items-center justify-center gap-6 rounded-2xl border-2 border-brand-deep bg-white p-10 text-center print:rounded-none print:border-0">
        <BrandMark withTagline className="scale-150" />
        <h2 className="font-display mt-6 text-5xl font-extrabold">{face.title}</h2>
        {face.subtitle && <p className="text-2xl text-muted">{face.subtitle}</p>}
        <QrImage svg={face.svg} className="my-4 w-[120mm]" />
        <p className="text-3xl font-semibold">{face.instruction}</p>
        <p className="tabular text-sm break-all text-muted">{shortUrl(face.url)}</p>
      </article>
    );
  }
  return <QrCard face={face} className="mx-auto max-w-sm" />;
}

/** Card · Table tent · Poster, as links that keep the rest of the page's address. */
export function QrLayoutPicker({ current, hrefFor }: { current: QrLayout; hrefFor: (layout: QrLayout) => string }) {
  return (
    <nav aria-label="Print layout" className="flex flex-wrap gap-2 print:hidden">
      {QR_LAYOUTS.map((layout) => (
        <Link
          key={layout}
          href={hrefFor(layout)}
          aria-current={layout === current ? 'page' : undefined}
          className={cn(
            'rounded-full border px-4 py-1.5 text-sm font-medium',
            layout === current ? 'border-brand-deep bg-brand-leaf-tint text-brand-deep' : 'border-line-strong text-ink hover:bg-ink/5',
          )}
        >
          {LAYOUT_LABELS[layout]}
        </Link>
      ))}
    </nav>
  );
}
