'use client';

import { ChevronRight, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PersonPicker } from '@/components/portal/person-picker';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import type { TreeNode } from '@/server/modules/hierarchy/hierarchy.queries';

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: T };
  return body.data ?? null;
}

/**
 * Indented, lazily loaded tree (WAI-ARIA tree pattern, simplified): readable at any size,
 * unlike a zoomable org chart, and only loads the branches someone opens.
 */
export function TreeExplorer({ roots }: { roots: TreeNode[] }) {
  const [children, setChildren] = useState<Record<string, TreeNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback(
    async (personId: string): Promise<boolean> => {
      if (children[personId]) return true;
      setLoading((s) => new Set(s).add(personId));
      const data = await fetchJson<TreeNode[]>(`/api/hierarchy/children?parentId=${personId}`);
      setLoading((s) => {
        const next = new Set(s);
        next.delete(personId);
        return next;
      });
      if (!data) {
        setError('Couldn’t load that group. Please try again.');
        return false;
      }
      setChildren((c) => ({ ...c, [personId]: data }));
      return true;
    },
    [children],
  );

  async function toggle(node: TreeNode) {
    setError(null);
    if (expanded.has(node.personId)) {
      setExpanded((s) => {
        const next = new Set(s);
        next.delete(node.personId);
        return next;
      });
      return;
    }
    if (await load(node.personId)) setExpanded((s) => new Set(s).add(node.personId));
  }

  async function jumpTo(personId: string) {
    setError(null);
    const path = await fetchJson<string[]>(`/api/hierarchy/path?personId=${personId}`);
    if (!path || path.length === 0) {
      setError('That person isn’t in the part of the structure you can see.');
      return;
    }
    const ancestors = path.slice(0, -1);
    for (const id of ancestors) {
      if (!children[id]) {
        const data = await fetchJson<TreeNode[]>(`/api/hierarchy/children?parentId=${id}`);
        if (data) setChildren((c) => ({ ...c, [id]: data }));
      }
    }
    setExpanded((s) => new Set([...s, ...ancestors]));
    setHighlight(personId);
  }

  useEffect(() => {
    if (highlight) rowRefs.current[highlight]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight, children, expanded]);

  function renderNodes(nodes: TreeNode[], level: number) {
    return (
      <ul role={level === 0 ? 'tree' : 'group'} aria-label={level === 0 ? 'Leadership structure' : undefined} className={cn(level > 0 && 'ml-5 border-l border-line pl-2')}>
        {nodes.map((node) => {
          const isOpen = expanded.has(node.personId);
          const hasChildren = node.visibleChildren > 0;
          return (
            <li key={node.personId} role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={highlight === node.personId}>
              <div
                ref={(el) => {
                  rowRefs.current[node.personId] = el;
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-ground',
                  highlight === node.personId && 'bg-brand-leaf-tint ring-1 ring-brand-deep/30',
                )}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(node)}
                    aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}’s group`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-ink/5 hover:text-ink"
                  >
                    {loading.has(node.personId) ? (
                      <LoaderCircle aria-hidden className="size-4 animate-spin" />
                    ) : (
                      <ChevronRight aria-hidden className={cn('size-4 transition-transform', isOpen && 'rotate-90')} />
                    )}
                  </button>
                ) : (
                  <span className="size-7 shrink-0" aria-hidden />
                )}
                <Link href={`/app/people/${node.personId}`} className="min-w-0 truncate font-medium hover:text-brand-deep hover:underline">
                  {node.name}
                </Link>
                {node.levelName && <span className="hidden text-xs text-muted sm:inline">{node.levelName}</span>}
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {node.status === 'inactive' && <Badge>Inactive</Badge>}
                  {node.acceptsMembers && <Badge tone="green">Receives people</Badge>}
                  {node.branchSize > 0 && (
                    <span className="tabular text-xs text-muted">
                      {node.branchSize.toLocaleString('en-PH')} in branch
                    </span>
                  )}
                </span>
              </div>
              {isOpen && children[node.personId] && renderNodes(children[node.personId]!, level + 1)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <PersonPicker
          name="jump"
          label="Find someone in the structure"
          placedOnly
          onChange={(value) => {
            if (value) void jumpTo(value.id);
            else setHighlight(null);
          }}
        />
      </div>
      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3">{renderNodes(roots, 0)}</div>
    </div>
  );
}
