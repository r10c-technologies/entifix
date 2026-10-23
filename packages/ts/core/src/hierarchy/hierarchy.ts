import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import {
  assertOneParent,
  assertParentVisible,
} from '../entity-definition/describe/index.js';
import { extractMetaAccessors } from '../entity-definition/helpers/index.js';
import type { ChildConstructor } from '../entity-definition/meta-entities/meta-accessor/index.js';

/**
 * How to read a record's place in a tree: its own key, and its parent's key or
 * `undefined` for a root. Every helper here takes one, so the same walk serves
 * an entity, a plain fixture row and a draft.
 */
export interface HierarchyKeys<T> {
  readonly idOf: (item: T) => string;
  readonly parentOf: (item: T) => string | undefined;
}

/** One record and the records whose parent it is, in their incoming order. */
export interface TreeNode<T> {
  readonly item: T;
  readonly depth: number;
  readonly children: readonly TreeNode<T>[];
}

/**
 * A set of records arranged as a tree.
 *
 * `detached` holds the records on a cycle — `a` is `b`'s parent and `b` is
 * `a`'s. No root leads to them, so they are in no subtree. They are
 * returned rather than dropped, because a record that silently disappears
 * from a listing is a defect nobody can see. A host that enforces the
 * invariant at save ({@link wouldCycle}) never has any.
 */
export interface Tree<T> {
  readonly roots: readonly TreeNode<T>[];
  readonly detached: readonly T[];
}

/** A tree node as one row of a flat listing. */
export interface TreeRow<T> {
  readonly item: T;
  readonly depth: number;
  readonly hasChildren: boolean;
  /** The keys of every ancestor, root first. */
  readonly path: readonly string[];
}

/** An empty parent key is no parent, the way an empty form control is no value. */
const parentKey = <T>(keys: HierarchyKeys<T>, item: T) => {
  const parent = keys.parentOf(item);
  return parent === undefined || parent === '' ? undefined : parent;
};

/**
 * Arrange records as a tree.
 *
 * A record whose parent is not in the set is a **root**: a page of records
 * holds children whose parents are on another page, and a retired or deleted
 * parent leaves its children behind. Siblings keep the order they came in,
 * so a sorted load stays sorted within each level.
 */
export function buildTree<T>(
  items: readonly T[],
  keys: HierarchyKeys<T>,
): Tree<T> {
  const byKey = new Map(items.map(item => [keys.idOf(item), item]));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const parent = parentKey(keys, item);
    if (parent === undefined || !byKey.has(parent)) {
      roots.push(item);
    } else {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), item]);
    }
  }

  const placed = new Set<string>();
  const node = (item: T, depth: number): TreeNode<T> => {
    const key = keys.idOf(item);
    placed.add(key);
    return {
      item,
      depth,
      children: (childrenOf.get(key) ?? []).map(child =>
        node(child, depth + 1),
      ),
    };
  };
  const tree = roots.map(root => node(root, 0));

  return {
    roots: tree,
    detached: items.filter(item => !placed.has(keys.idOf(item))),
  };
}

/** The tree as rows, depth first: each record followed by its subtree. */
export function flattenTree<T>(
  tree: Tree<T>,
  keys: HierarchyKeys<T>,
): TreeRow<T>[] {
  const rows: TreeRow<T>[] = [];
  const walk = (node: TreeNode<T>, path: readonly string[]) => {
    rows.push({
      item: node.item,
      depth: node.depth,
      hasChildren: node.children.length > 0,
      path,
    });
    for (const child of node.children) {
      walk(child, [...path, keys.idOf(node.item)]);
    }
  };
  for (const root of tree.roots) walk(root, []);
  return rows;
}

/**
 * The ancestors of `key`, root first, not including the record itself.
 *
 * Stops at the first key it has already visited, so data that holds a cycle
 * yields a finite chain rather than a hung render.
 */
export function ancestorsOf<T>(
  items: readonly T[],
  keys: HierarchyKeys<T>,
  key: string,
): T[] {
  const byKey = new Map(items.map(item => [keys.idOf(item), item]));
  const chain: T[] = [];
  const seen = new Set([key]);
  let current = byKey.get(key);
  while (current !== undefined) {
    const parent = parentKey(keys, current);
    if (parent === undefined || seen.has(parent)) break;
    seen.add(parent);
    current = byKey.get(parent);
    if (current !== undefined) chain.unshift(current);
  }
  return chain;
}

/** The keys of every record under `key`, at any depth. Cycle-safe. */
export function descendantsOf<T>(
  items: readonly T[],
  keys: HierarchyKeys<T>,
  key: string,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const item of items) {
    const parent = parentKey(keys, item);
    if (parent === undefined) continue;
    childrenOf.set(parent, [
      ...(childrenOf.get(parent) ?? []),
      keys.idOf(item),
    ]);
  }
  const found: string[] = [];
  const seen = new Set([key]);
  const queue = [...(childrenOf.get(key) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    found.push(next);
    queue.push(...(childrenOf.get(next) ?? []));
  }
  return found;
}

/**
 * Would giving `key` the parent `parent` make a cycle? True when the parent is
 * the record itself or anything under it. The check a save runs, and the set a
 * parent picker excludes.
 */
export function wouldCycle<T>(
  items: readonly T[],
  keys: HierarchyKeys<T>,
  key: string,
  parent: string | undefined,
): boolean {
  if (parent === undefined || parent === '') return false;
  return parent === key || descendantsOf(items, keys, key).includes(parent);
}

/** How deep `key` sits: 1 for a root, 2 for its children, and so on. */
export function depthOf<T>(
  items: readonly T[],
  keys: HierarchyKeys<T>,
  key: string,
): number {
  return ancestorsOf(items, keys, key).length + 1;
}

/**
 * The keys an entity's own metadata declares: its `id`, and the member marked
 * `@accessor({ parent: true })` — read by its wire key, the way a record
 * arrives. `undefined` when the entity declares no parent and so is not a
 * tree.
 *
 * Refuses a `hidden` or `readonly` parent, for the reason describing an
 * entity does: such a member is never serialized, so the tree would arrive
 * flat.
 */
export function hierarchyOf<T extends object>(
  target: ChildConstructor<T>,
): HierarchyKeys<T> | undefined {
  const accessors = extractMetaAccessors(target).filter(
    accessor => accessor.kind === 'getter',
  );
  assertOneParent(accessors);
  assertParentVisible(accessors);
  const parent = accessors.find(accessor => accessor.parent === true);
  if (parent === undefined) return undefined;
  if (
    parent.type !== undefined &&
    parent.type !== 'id' &&
    parent.type !== 'string'
  ) {
    throw new EntifixBuildError(
      `"${String(parent.name)}" is a ${parent.type} and cannot be the parent member — a parent is one record's id, so it is an id or a string.`,
    );
  }
  const member = String(parent.alias ?? parent.name);
  const read = (item: T, name: string) =>
    (item as Record<string, unknown>)[name];
  const asKey = (value: unknown) =>
    value === undefined || value === null ? undefined : String(value);

  return {
    idOf: item => String(read(item, 'id') ?? ''),
    parentOf: item => asKey(read(item, member)),
  };
}
