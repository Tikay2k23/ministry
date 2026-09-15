import { BrandMark } from '@/components/brand/brand-mark';

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <BrandMark withTagline className="mb-8 text-center" />
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-sm sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-muted">Generation Touch Harvest International</p>
      </div>
    </main>
  );
}
