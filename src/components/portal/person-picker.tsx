'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { inputClassName } from '../ui/field';

export interface PersonOption {
  id: string;
  name: string;
  personCode: string;
  hint: string | null;
}

/**
 * Accessible typeahead for choosing a person (WAI-ARIA combobox pattern).
 * Results come from /api/people/search and are always limited to the viewer's scope
 * (or, in `leader_directory` mode, to leaders who receive new people).
 * The chosen id is submitted through a hidden input named `name`.
 */
export function PersonPicker({
  name,
  label,
  hint,
  errors,
  defaultValue = null,
  placedOnly = false,
  permission = 'people.view',
  excludeIds = [],
  required = false,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  errors?: string[];
  defaultValue?: { id: string; name: string } | null;
  placedOnly?: boolean;
  permission?: 'people.view' | 'people.create' | 'hierarchy.manage' | 'leader_directory';
  excludeIds?: string[];
  required?: boolean;
  onChange?: (value: { id: string; name: string } | null) => void;
}) {
  const baseId = useId();
  const [selected, setSelected] = useState(defaultValue);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<PersonOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const excludeKey = excludeIds.join(',');
  const searching = query.trim().length >= 2;
  // Derived rather than cleared in an effect: short queries simply show nothing.
  const visibleOptions = searching ? options : [];

  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: query.trim(), permission });
        if (placedOnly) params.set('placed', '1');
        const response = await fetch(`/api/people/search?${params}`, { signal: controller.signal });
        const body = (await response.json()) as { data?: PersonOption[] };
        const exclude = new Set(excludeKey ? excludeKey.split(',') : []);
        setOptions((body.data ?? []).filter((o) => !exclude.has(o.id)));
        setActive(-1);
        setOpen(true);
      } catch {
        /* aborted or offline: keep previous options */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, placedOnly, permission, excludeKey]);

  function choose(option: PersonOption) {
    const value = { id: option.id, name: option.name };
    setSelected(value);
    setQuery('');
    setOptions([]);
    setOpen(false);
    onChange?.(value);
  }

  function clear() {
    setSelected(null);
    onChange?.(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(visibleOptions.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter' && open && active >= 0 && visibleOptions[active]) {
      event.preventDefault();
      choose(visibleOptions[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const listId = `${baseId}-list`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="space-y-1.5">
      <label htmlFor={`${baseId}-input`} className="block text-sm font-medium">
        {label}
      </label>
      <input type="hidden" name={name} value={selected?.id ?? ''} />
      {selected ? (
        <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3">
          <span className="truncate text-[15px]">{selected.name}</span>
          <button
            type="button"
            onClick={clear}
            className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink"
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            id={`${baseId}-input`}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-expanded={open && searching}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && visibleOptions[active] ? `${baseId}-opt-${active}` : undefined}
            aria-invalid={hasError || undefined}
            aria-required={required || undefined}
            placeholder="Type at least 2 letters or a person code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => visibleOptions.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className={cn(inputClassName, 'pl-9')}
          />
          {open && searching && (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
            >
              {visibleOptions.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">{loading ? 'Searching…' : 'No matches in your scope.'}</li>
              )}
              {visibleOptions.map((option, index) => (
                <li
                  key={option.id}
                  id={`${baseId}-opt-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(option);
                  }}
                  className={cn('cursor-pointer px-3 py-2', index === active ? 'bg-brand-leaf-tint' : 'hover:bg-ground')}
                >
                  <p className="text-[15px] font-medium">{option.name}</p>
                  <p className="text-xs text-muted">
                    {option.personCode}
                    {option.hint ? ` · ${option.hint}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {hint && !hasError && <p className="text-sm text-muted">{hint}</p>}
      {hasError && (
        <p className="text-sm text-error" role="alert">
          {errors!.join(' ')}
        </p>
      )}
    </div>
  );
}
