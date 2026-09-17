import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * One accessibility scan of the current page (docs/07 §7 "Accessibility"): WCAG 2.2 AA plus the
 * 2.0/2.1 rule sets it's built on. Failures list the rule, why it matters, and which elements, so
 * a failure is fixable from the test output alone.
 */
export async function expectNoAccessibilityViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const report = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.helpUrl}\n${v.nodes.map((n) => `  - ${n.target.join(' ')}: ${n.failureSummary}`).join('\n')}`)
    .join('\n\n');
  expect(results.violations, `${label}\n\n${report}`).toEqual([]);
}
