# 27. The table evolves natively: header sort, container pivot, live counts, and no table engine yet

- Status: Proposed
- Date: 2026-11-05
- Area: ui
- Read when: a list shows cards inside a wide workspace pane or a cramped table in a narrow one, a screen reader cannot tell how a list is sorted or how many rows a filter kept, a table's horizontal scroll cannot be reached by keyboard, choosing between `table` and `grid` semantics, or about to add `@tanstack/react-table` or another table engine

## Context

`EntityTable` renders a native `<table>` with `th scope="col"`, from entity
metadata. It holds the following state, all controlled from above:

- RSQL filtering, sorting and pagination, evaluated on the server through
  `useDataLoading`;
- a selection union of `ids` versus `matching` with exclusions, which two
  states must never collapse into;
- column visibility and order through the UI-preferences port;
- tree expansion for hierarchical entities.

It is accessible in parts — row checkboxes named by record, a tri-state header,
a polite loading status — and falls short in the ways every list inherits:

- **Sort is invisible.** No header is clickable and none carries `aria-sort`.
  Sorting is reachable only through the sort-builder panel.
- **Results are silent.** After a filter, sort or page change, the new count is
  never announced.
- **Panel state is shown by colour only.** The Filters/Sort toggles expose no
  `aria-expanded`.
- **The scroll region is not focusable.** Its `overflow-x-auto` wrapper is not
  focusable, so a wide table's hidden columns cannot be reached by keyboard
  (axe `scrollable-region-focusable`).
- **The card pivot keys on the viewport** (`md:`). It is wrong inside workspace
  split views, drawers and wizard steps. The cards are anonymous `div`s, with
  no list or heading semantics, and they drop tree depth.
- **The table has no name.** There is no caption, and row action triggers are
  named identically on every row.
- **Pagination is silent and small.** Its summary is not live and its controls
  sit at the 24px edge.

The open question was whether to rebuild on a headless table engine.
`@tanstack/react-table` (v9, feature-scoped, about 15 kB min+gz for v8) is the
common choice. Here it would replace very little:

- Every evaluation is server-side.
- Its page-local `rowSelection` cannot express the `matching` selection.
- Columns come from `@accessor()` metadata, not `ColumnDef`s.
- It provides no accessibility: no `aria-sort`, no grid keyboard model, no live
  regions.

About 280 lines of state code would be replaced by an adapter of similar size.
Controls today depend only on Headless UI, CVA and `idb`. The form engine was
kept out of controls, behind a facade in `react-integration`, for the same
reason.

## Decision

### Sort, name, scroll, announce

- **Every sortable column's header holds a `<button>`** named by the column
  label. The `th` carries `aria-sort` only on the active primary key.
  - A click cycles ascending → descending → none.
  - Shift+click adds a secondary key.
  - The sort builder stays for anything more complex.
  - The arrow glyph is `aria-hidden`.
- **The table is named by a caption** stating entity, count and sort ("Brands,
  48 results, sorted by name"). It is visually hidden where the screen already
  has a heading.
- **When the table overflows,** its scroll container becomes `tabindex="0"
role="region"` labelled by the caption.
- **The header is sticky,** with `scroll-padding-top` equal to its height so a
  focused row never hides beneath it (2.4.11).
- **One polite status region per table** — the loading one that exists — says
  "{count} results" or "No results for these filters" each time a filter, sort
  or page change settles. It is debounced and silent on first render.
- **Filter and sort toggles carry `aria-expanded` and `aria-controls`,** and
  show the active count ("Filters · 2"). Applied filters render as removable
  chips ("Remove filter: Status is draft") with "Clear all". Facet counts
  ([ADR 0012](0012-facet-counts-are-a-port-of-their-own.md)) render inside the
  filter builder for enum and link members.
- **Pagination is a `nav` landmark** with First/Prev/Next/Last at
  `--target-min` ([ADR 0025](0025-the-token-contract.md)). A disabled end stays
  focusable with `aria-disabled`. A page change keeps focus on the control and
  announces "Page 2 of 5".
- **Each row's title is its link,** and its menu trigger is named "Actions for
  {record}" ([ADR 0026](0026-actions-hierarchy-overflow-and-destructive-verbs.md)).
- **A refetch keeps previous rows at full contrast** and marks the region
  `aria-busy`. It does not dim through opacity, which failed 1.4.3.

### The pivot is a container query, and the card has semantics

- **The table's root is a named container,** and the table/card switch is a
  container query rather than a viewport breakpoint.
  - The threshold derives from the visible columns: the sum of each column's
    `minWidth`, from a new `@accessor({ minWidth })` with type defaults.
  - An explicit `pivotBreakpoint` stays as an override.
  - It remains CSS-only, so server rendering and hydration agree.
- **The inactive layout is `display: none`,** so assistive technology meets one
  copy.
- **A card list is `<ul role="list">` of `<article aria-labelledby>`.**
  - Each card has an `h3` holding the record link, stretched so the card is one
    target. The checkbox and menu sit above it.
  - A `dl` follows for the meta.
  - What a card shows comes from a new presentation hint,
    `@accessor({ card: 'title' | 'subtitle' | 'badge' | 'meta' | 'hidden' })`.
    Without hints: the row label is the title, the first enum is the badge, and
    up to three further visible columns are meta.
  - A tree entity's card carries `aria-level`.
- **Selection and actions survive the switch unchanged.** They are already
  controlled from above, and both layouts render the same `<ActionBar>`.

### Table, not grid, unless the editing demands it

| Use                                      | Semantics                                                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every read list                          | Native `table`; interactive cells in the Tab order; one link and one menu per row                                                                                                        |
| Master-detail editing (EntityDetailGrid) | `table` of form controls; the WAI-ARIA `grid` pattern (roving cell focus, Enter/F2 to edit, Escape to leave) only when one grid has more than about five editable columns over many rows |
| Hierarchies                              | `table` with disclosure buttons; `treegrid` only when cross-row expand/collapse by keyboard is needed                                                                                    |

- Selection is always checkboxes, never `aria-selected` rows.
- EntityDetailGrid drops its incorrect `aria-rowcount`.

### No table engine now, and the two things that would change that

`@tanstack/react-table` is **not** adopted. It is revisited when either of these
happens:

1. a screen needs column resizing or pinning;
2. a client-side list must render more than about 500 rows and needs
   virtualization.

On that day it arrives as follows:

- v9 with only the features used;
- an **optional peer behind a subpath** (or in `react-integration`), registered
  in the tier register's optional capabilities;
- `@tanstack/react-virtual` the same way;
- **no TanStack type in EntityTable's public API,** so a host whose UI packages
  ban the engine's imports is unaffected.

## Consequences

- Header sort duplicates part of the sort builder's job. The builder stays for
  multi-key and nested sorts; the header is the common case.
- `minWidth` and `card` are new presentation metadata. A host that sets neither
  gets derived defaults that are reasonable rather than tuned.
- The container pivot changes which layout some screens show today. A wide pane
  on a phone-sized viewport now shows the table, and a narrow pane on a desktop
  shows cards. That is the intended correction.
- Declining the engine keeps the bundle and the dependency list as they are. It
  also means resize, pinning and virtualization are not available until a
  trigger fires.

## Trigger

Promoted to **Accepted** by the change that lands header sort with `aria-sort`,
the caption, the focusable scroll region, the sticky header, live counts,
`aria-expanded` toggles with chips, accessible pagination, and the container
pivot with semantic cards.
