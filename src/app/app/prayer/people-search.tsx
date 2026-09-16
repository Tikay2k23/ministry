'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';

/** Someone who can be put on a prayer slot (GET /api/prayer/people, and the substitute suggestions). */
export interface PersonOption {
  personId: string;
  name: string;
  personCode?: string;
  inPool?: boolean;
  recentSlots?: number;
}

export const pickButtonClass = 'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-ground disabled:opacity-50';

/** Finds people for a chain: those who already pray in it first, then anyone by name or person code. */
export function PeopleSearch({ chainId, onPick, disabled }: { chainId: string; onPick: (person: PersonOption) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(false);
  const searching = query.trim().length >= 2;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/prayer/people?${new URLSearchParams({ chainId, q: query.trim() })}`, { signal: controller.signal });
        const body = (await response.json()) as { data?: PersonOption[] };
        setResults(body.data ?? []);
      } catch {
        // aborted, or offline: keep the previous results
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [chainId, query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          aria-label="Search people"
          placeholder="Search by name or person code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(inputClassName, 'pl-9')}
        />
      </div>
      <p className="text-xs text-muted">{searching ? (loading ? 'Searching…' : 'Everyone who matches') : 'People who pray in this chain'}</p>
      <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {results.length === 0 && (
          <li className="px-3 py-3 text-sm text-muted">{searching ? (loading ? 'Searching…' : 'No one found.') : 'No one yet. Type a name to search everyone.'}</li>
        )}
        {results.map((person) => (
          <li key={person.personId}>
            <button type="button" disabled={disabled} onClick={() => onPick(person)} className={pickButtonClass}>
              <span>
                <span className="block font-medium">{person.name}</span>
                {person.personCode && <span className="block text-xs text-muted">{person.personCode}</span>}
              </span>
              {person.inPool && <span className="text-xs text-muted">In this chain</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
