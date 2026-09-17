import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/field';

/** A plain GET form: choosing a branch opens its print sheet, no scripts needed. */
export function BranchPrintForm({ branches }: { branches: { personId: string; name: string; leaders: number }[] }) {
  return (
    <form method="get" action="/app/admin/qr/branch" className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <label htmlFor="branch" className="block text-sm font-medium">
          Branch
        </label>
        <select id="branch" name="personId" required className={inputClassName} defaultValue="">
          <option value="" disabled>
            Choose a Primary Leader…
          </option>
          {branches.map((branch) => (
            <option key={branch.personId} value={branch.personId} disabled={branch.leaders === 0}>
              {branch.name} ({branch.leaders === 1 ? '1 leader' : `${branch.leaders} leaders`})
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary">
        <Printer aria-hidden className="size-4" /> Open cards
      </Button>
    </form>
  );
}
