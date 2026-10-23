import {
  buildTree,
  type Entity,
  flattenTree,
  type HierarchyKeys,
  type TreeRow,
} from '@entifix/core';
import type { ReactNode } from 'react';

/**
 * The rows a table shows, in the order it shows them.
 *
 * For an entity that is not a tree, the page as it came. For one that is, the
 * page arranged depth first, siblings in the order the load sorted them. A
 * record whose parent is on another page is a root of this page, and records
 * on a cycle come last at depth 0, so no row the load returned goes missing.
 *
 * ⚠️ **The tree is the page's, not the store's.** A table is paged, so a
 * parent and its children only nest when they arrive together. A host that
 * wants the whole tree loads it whole: a vocabulary of a few hundred records
 * fits in one page.
 */
export function treeRows<TEntity extends Entity>(
  items: readonly TEntity[],
  keys: HierarchyKeys<TEntity> | undefined,
): TreeRow<TEntity>[] {
  if (keys === undefined) {
    return items.map(item => ({
      item,
      depth: 0,
      hasChildren: false,
      path: [],
    }));
  }
  const tree = buildTree(items, keys);
  return [
    ...flattenTree(tree, keys),
    ...tree.detached.map(item => ({
      item,
      depth: 0,
      hasChildren: false,
      path: [],
    })),
  ];
}

/** The rows left once every collapsed record's subtree is hidden. */
export function shownTreeRows<TEntity extends Entity>(
  rows: readonly TreeRow<TEntity>[],
  collapsed: ReadonlySet<string>,
): TreeRow<TEntity>[] {
  if (collapsed.size === 0) return [...rows];
  return rows.filter(row => !row.path.some(key => collapsed.has(key)));
}

/** Chevron — points right when collapsed, down when expanded. */
function TreeChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={`size-4 fill-current transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
    >
      <path d="M7.5 5.5 12 10l-4.5 4.5z" />
    </svg>
  );
}

/**
 * The first cell of a tree row: indented by depth, with a toggle when the
 * record has children and a spacer the same width when it does not, so every
 * label at one depth starts at the same x.
 */
export function TreeCell({
  depth,
  hasChildren,
  expanded,
  label,
  onToggle,
  children,
}: {
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  /** Names the toggle: "Collapse Lighting", not "Collapse". */
  label: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3xs"
      style={{ paddingInlineStart: `calc(${depth} * 1.25rem)` }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={label}
          onClick={onToggle}
          className="size-5 inline-flex items-center justify-center rounded-sm text-content-muted focus-ring hover:text-content"
        >
          <TreeChevron expanded={expanded} />
        </button>
      ) : (
        <span aria-hidden className="size-5 inline-block" />
      )}
      {children}
    </div>
  );
}
