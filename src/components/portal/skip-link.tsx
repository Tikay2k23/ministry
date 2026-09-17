/**
 * "Skip to content" (WCAG 2.4.1 Bypass Blocks): invisible until focused, so a keyboard or
 * screen-reader user doesn't have to tab through the whole sidebar on every page.
 */
export function SkipLink({ targetId = 'main-content' }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-brand-deep focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:outline-none focus:ring-2 focus:ring-white"
    >
      Skip to content
    </a>
  );
}
