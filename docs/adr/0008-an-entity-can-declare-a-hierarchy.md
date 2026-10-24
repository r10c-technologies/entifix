# 8. An entity can declare a hierarchy

- Status: Accepted
- Date: 2026-10-23
- Revised: 2026-10-24 — picking a parent did need something new: `makeEntityCrud` builds its pickers itself, so it gained a per-record `useBaseFiltering` on a link and a `pageSize` for the list
- Area: entities
- Read when: an entity's records nest under one another (categories, folders, accounts and their branches), building breadcrumbs or a tree from records, or about to write a recursive query — one member marks the parent, the tree is built in memory from the records already loaded, and a parent member must travel over the wire

## Context

A host's category vocabulary wants depth: _Home › Lighting › Desk lamps_, not
three unrelated words. The same shape recurs wherever records nest: folders, an
account and its branches, an organisation chart.

Nothing in entifix modelled it. An entity could hold the id of another record
of its own kind in an ordinary member, but nothing knew that member meant
"parent". So every host would write the same four things: a tree builder, an
ancestor walk for breadcrumbs, a descendant walk for "everything under this
node", and a cycle check at save. The generic table would still render the
records flat.

## Decision

### One member marks the parent

`@accessor({ parent: true })` on an `id` or `string` member says this member
holds the id of the record's parent, another record of the same entity. Absent
or `''` means a root.

**An id, not a `link`.** A tree is always built from the whole set of its
records, never by resolving one parent at a time, so a link's lazy resolution
would be a fetch per node that nothing needs. It also keeps the wire shape a
plain key, which any client can read without a resolver.

Describing the entity refuses, with an `EntifixBuildError`:

- **two parent members.** Two would be two trees over the same records, and
  which one a table indents by would depend on declaration order.
- **a parent that is not an `id` or a `string`.** A number or a date cannot
  name a record.
- ⚠️ **a parent that is `hidden` or `readonly`.** The serializer skips both
  in each direction, so the parent key would not survive one trip over the
  wire and the tree would arrive flat, with nothing failing. This was found by
  the example's own e2e, not by reasoning. A host that does not want the column
  shown hides it with a slot.

### The tree is built in memory, from records already loaded

`@entifix/core` ships pure helpers over a `HierarchyKeys<T>` (`idOf`,
`parentOf`), so the same walk serves an entity instance, a fixture row and a
draft:

| Helper          | Answers                                                     |
| --------------- | ----------------------------------------------------------- |
| `buildTree`     | the roots and their subtrees, plus any records on a cycle   |
| `flattenTree`   | the tree as rows, depth first, each with its depth and path |
| `ancestorsOf`   | the breadcrumb chain, root first                            |
| `descendantsOf` | every key under a node: a subtree listing's `in (…)`        |
| `wouldCycle`    | the check a save runs, and the set a parent picker excludes |
| `depthOf`       | how deep a node sits, for a depth cap                       |

`hierarchyOf(Entity)` reads the keys off the entity's own metadata, by wire
key, or answers `undefined` for an entity that is not a tree.

**No recursive query, no materialized path, no `$graphLookup`.** A vocabulary
that nests is authored by hand and stays small enough to load whole. A store
that outgrows one read wants a materialized ancestor path, and that is an
adapter decision for the store that needs it, not a shape every adopter pays for.

**Bad data degrades rather than throws.** A record whose parent is missing is
a root, because a page of records holds children whose parents are on another
page and a deleted parent leaves its children behind. Records on a cycle come
back as `detached` rather than vanishing, since a row that silently disappears
is a defect nobody sees. Every walk stops at the first key it revisits. The
invariants themselves (parent exists, no cycle, a depth cap, what retiring a
parent does) are the host's to enforce at save, because they are the host's
rules; `wouldCycle` and `depthOf` are what it enforces them with.

### The generic table renders the tree

`EntityTable` over an entity that declares a parent arranges its page depth
first, indents the first column, and gives each record with children a toggle
(`aria-expanded`, labelled by the record). Siblings keep the order the load
sorted them. A shift-click range runs over the rows as shown.

⚠️ **The tree is the page's, not the store's.** A table is paged, so a parent
and its children nest only when they arrive together. A host that wants the
whole tree loads it in one page — on a generated list, `makeEntityCrud`'s
`pageSize`.

### Picking a parent

A `string` foreign key with a `linkSources` entry already gets the full picker.
The host excludes the record and its subtree through the source's
`baseFiltering`, with the keys `descendantsOf` returns.

That held for a form a host wires itself with `useEntityLinkSource`, and not for
the one `makeEntityCrud` generates, which builds each source and took no filter.
A link there carries `useBaseFiltering(record)`: a **hook**, not a function of
the record, because the subtree is other records and the rule has to load them.
It runs on every render of the single view — with `undefined` on a create and
while the record loads — and answers `undefined` for no restriction. The
workspace example's customer picker is the reference use. The filter narrows the
suggestions only; the save still has to refuse a cycle with `wouldCycle`.

### Cloning keeps the parent

A copy of a node is its sibling. `cloneEntityDraft` resets every `id` member
except the parent, because a copy that came out as a root would be a move.

## Consequences

- `MetaAccessorOptions` gains `parent`, and `EntityFieldDescriptor` gains an
  optional `parent`. Optional, so descriptors a host builds by hand keep
  compiling.
- `@entifix/react-controls` gains two catalog keys, `table.expandRow` and
  `table.collapseRow`, in both locales.
- The workspace example's `Customer` declares a parent and its e2e asserts the
  nesting, the fold and a parent picker that offers nothing from the customer's
  own subtree (ADR 0004).

## Reopen when

A host needs a record under two parents (a DAG), or a tree too large to load in
one page. Either changes the shape, not the helpers' names.
