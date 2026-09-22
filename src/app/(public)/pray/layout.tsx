/**
 * The prayer chain page shows a whole day of hours, which needs more room than the one-column
 * public shell gives a journal form. On a large screen it steps out of that column and centres
 * itself on the viewport instead; on a phone it stays exactly as wide as everything else.
 */
export default function PrayerChainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl lg:relative lg:left-1/2 lg:w-[min(72rem,100vw-4rem)] lg:max-w-none lg:-translate-x-1/2">
      {children}
    </div>
  );
}
