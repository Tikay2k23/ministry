'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { inputClassName } from '@/components/ui/field';
import { cn } from '@/lib/cn';

/** Someone who can be put on a roster or a team (GET /api/devotional/people). */
export interface ServingPerson {
  personId: string;
  name: string;
  personCode?: string;
  onTeam?: boolean;
  playsRole?: boolean;
}

export const pickButtonClass = 'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-ground disabled:opacity-50';

/**
 * Finds people for a roster (people who play the role and the gathering's team first) or for a
 * worship team (anyone, by name or person code).
 */
export function ServingPeopleSearch({
  scope,
  onPick,
  disabled,
}: {
  scope: { gatheringId: string; servingRoleId?: string } | { teamId: string };
  onPick: (person: ServingPerson) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ServingPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const searching = query.trim().length >= 2;
  const forTeam = 'teamId' in scope;
  const scopeKey = JSON.stringify(scope);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ ...(JSON.parse(scopeKey) as Record<string, string>), q: query.trim() });
        const response = await fetch(`/api/devotional/people?${params}`, { signal: controller.signal });
        const body = (await response.json()) as { data?: ServingPerson[] };
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
  }, [scopeKey, query]);

  const emptyText = searching
    ? loading
      ? 'Searching…'
      : 'No one found.'
    : forTeam
      ? 'Type at least two letters of a name.'
      : 'No one on the team plays this role. Type a name to search everyone.';

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
      {!forTeam && <p className="text-xs text-muted">{searching ? 'Everyone who matches' : 'People who play this role, and the gathering’s team'}</p>}
      <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">{emptyText}</li>}
        {results.map((person) => (
          <li key={person.personId}>
            <button type="button" disabled={disabled} onClick={() => onPick(person)} className={pickButtonClass}>
              <span>
                <span className="block font-medium">{person.name}</span>
                {person.personCode && <span className="block text-xs text-muted">{person.personCode}</span>}
              </span>
              <span className="text-right text-xs text-muted">
                {person.playsRole ? 'Plays this role' : person.onTeam ? 'On the team' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
