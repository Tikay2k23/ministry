import Link from 'next/link';
import { BrandMark } from '@/components/brand/brand-mark';
import { SkipLink } from '@/components/portal/skip-link';

/** Mobile-first shell for the login-free pages: larger type, one column, no portal chrome. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col text-[18px] leading-relaxed">
      <SkipLink />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-xl items-center px-4 py-3">
          <BrandMark />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-xl flex-1 px-4 py-6 pb-12 outline-none">
        {children}
      </main>
      <footer className="mx-auto w-full max-w-xl px-4 pb-8 text-center text-sm text-muted">
        <p>Generation Touch Harvest International</p>
        <p className="mt-1">
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
            Privacy notice
          </Link>
        </p>
      </footer>
    </div>
  );
}
