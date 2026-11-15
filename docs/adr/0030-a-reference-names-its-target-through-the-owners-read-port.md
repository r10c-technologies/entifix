# 30. A reference names its target through the owner's read port, and a record names itself

- Status: Accepted
- Revised: 2026-11-15 — record search finds a record through the one it refers to, and a record search result names itself as every other surface does
- Revised: 2026-11-15 — an undeclared name is a text member only: a number, an enum or a date the record holds never names it
- Revised: 2026-11-15 — a table's open link and sticky title follow the same text-only rule, a row nothing on screen names opens from a leading column that reads as its label, and a list leaves out the record's own key
- Date: 2026-11-14
- Area: entities
- Read when: a list, a form, a confirm dialog or a breadcrumb shows `product-offering-10` or a UUID where a person needs a name, a member holds another entity's id and cannot be a `link` because the target lives in another store, a list needs a column whose value lives in another entity (a price, a stock level, a picture), a record page needs the records that point at it, or about to add another "first filled-in member" guess at what a record is called

## Context

A host built on entifix keeps its stores apart: an entity that refers to a
record in another store holds that record's **id** in a plain `id` or `string`
member, never a `link`. A `link` invites the storage-layer join that would
couple two stores, and its accessor would have to import the target's class,
which a domain package may not do when the target belongs to another domain.
That rule is right and stays. What it left unsolved is how such an id reads.

Measured on the first adopting host (0.20.3):

- **Every cross-store id renders as itself.** A stock list shows
  `product-offering-1`; a shipment's lines show `product-offering-10`; an order
  list shows UUIDs. `CellValue` renders an `id`/`string` member as its text,
  because nothing says the text is a key.
- **The one fix that exists is per call site and per id.** `makeEntityCrud({
links })` (#200) names a target and a `labelProperty` for a picker, and its list
  reuses that to resolve labels through `useLinkLabels`: **one `get` per distinct
  id** on the page, only in the list grid, never in the read form, the detail grid,
  a card title, a confirm dialog or a breadcrumb. A label it cannot read renders
  `—`, so the id the reader could at least have quoted to someone is gone too.
- **What a record is called is guessed in five places.** `EntityTable`'s
  `rowLabel`/`titleColumn`, `EntityForm`'s `recordLabel`, `makeEntityCrud`'s
  `recordLabelOf`, and the card title all take "the first filled-in non-`id`
  member". On a shipment that is `orderId`, so a dispatch confirm reads
  "Dispatch 79ce50c8-…?". `recordLabel` on `EntityForm` lets a host override one
  of the five, as a string.
- **Values that live in another entity cannot be shown at all.** An offering
  list has no price or stock column because the price is a `ProductOfferingPrice`
  pointing at the offering and the stock a `StockItem` pointing at it: reverse
  references into, in one case, another store.

entifix already has the shape of the answer one tier down:
`EntityLinkResolverTag` and `createEntityLinkResolver` register, at composition,
which repository loads which target. That resolver is keyed by constructor,
because a `link` knows its target's class. A cross-store reference does not.

## Decision

### A member declares what it refers to, by key

`@accessor({ references: { entity: '<domain>:<key>' } })` on an `id` or `string`
member says the member holds the id of a record of that entity. The entity is
named by the same `domain:key` pair `@entity({ domain, key })` derives
permissions from, so the declaring package imports nothing of the target's.

- It is presentation and resolution metadata only. The member stays an `id` or a
  `string` to validation, queries, serialization and every adapter. Filtering and
  sorting still act on the id.
- It is legal on a `composition` child's member too: a shipment line's
  `offeringId` is the same kind of reference as a stock item's.
- Describing the entity fails on `references` declared on any other type, on a
  malformed key, or on a `parent: true` member naming any entity but its own: a
  parent is a record of the same entity, built into a tree (ADR 0008), and
  declaring it a reference to itself is what lets a list show a branch's parent
  by name rather than by key.

### A record declares what names it

`@entity({ labelMember: '<accessor name>' })` names the member a record is
called by: a `string`, a `localized`, a `number`, or a **reference**, in which
case the record is called by its target's label (a stock item is called by its
offering's name). Describing the entity fails on a member that does not exist,
is hidden, or is a collection.

`recordLabel(entityConstructor, record)` in `@entifix/core` is the **one
derivation**, and every surface that names a record calls it: a row's title and
checkbox name, a card's heading, a confirm dialog's object, a breadcrumb, a
toast, the `typed` delete policy. Core knows neither the reader's locale nor the
entity's translated noun, so it answers with what to show rather than a string —
a text, a reference to resolve, or a fallback carrying the short id — and
`useRecordLabel()` in `@entifix/react-controls` turns that into words. In order:

1. the declared `labelMember` — or, failing one, the member declared the card's
   `title`, which already says the same thing — resolved if it is a reference;
2. undeclared: the first filled-in **text** member — a `string` or a
   `localized` — that is neither an `id`, a reference, a `link`, a hidden
   member nor a collection. A number, an enum or a date is a value the record
   holds, not what it is called: with the kinds that are keys excluded but
   those left in, an order with no text member was called by its payment
   method ("card") and a shipment by its status ("dispatched"). A host that
   wants a number to name a record declares it as the `labelMember`;
3. nothing: the entity's noun with the id's short form — an id of twelve
   characters or fewer whole, a longer one cut to its first eight ("Shipment
   79ce50c8"). A whole UUID is never a label, and `offering-12` is not cut to
   `offering`, which would call every offering the same.

`EntityForm`'s `recordLabel` prop is removed; a host declares `labelMember`.

A table follows the same order. The cell that carries a row's open link, and
the title column held sticky while the grid scrolls, are the declared name's
column, else the first **text** column — never a status or a quantity, which
opened an order on "0" or "Paid" while its checkbox called it by its noun and
short id. When no visible column names a row — every member a value, or the
naming column hidden — the table adds one leading column headed by the entity's
noun, whose cell is the row's label; a row whose naming cell is empty reads as
its label there. Every row has exactly one open link.

**A list leaves out the record's own key.** The entity's `id` is how a record
is addressed, not how a person reads it, and the row already opens by its name.
`EntityTable` withholds it by default — from the grid, the settings, the filters
and the sort choices — and a host that needs it passes `showKey`. A key that
references another record is a reference, and stays.

### The host registers how each target is read, once

A new port in `@entifix/business`, `ReferenceLabelsTag`:

    resolve(entityKey, ids) → Effect<ReadonlyMap<id, label>, EntifixFailure>

and its default, `createReferenceLabels(registrations)`, built from repository
adapters that already exist, exactly as `createEntityLinkResolver` is:
`[TargetConstructor, repositoryContext, { labelProperty? }]`. The key is derived
from the constructor's `@entity()`, and `labelProperty` defaults to the target's
own `labelMember`, and then to the value rung of its own record label. It must
be a scalar: a target labelled by another reference is refused at registration,
so resolution is always one hop. A long list of ids is split into reads of at
most one hundred, which keeps a filter's URL and a server's page-size cap out of
reach; a page names far fewer.

- **One read per target entity per page**: a `load` filtered `id=in=(…)` over the
  distinct ids, page size equal to their count. The target's `id` must be
  `filterable`, which a scalar is by default.
- It goes through the **owner's own read path**, under the reader's own
  session. A label the reader may not read is not shown.
- The registry is composed by the **host**, where every target's adapter is in
  reach. A shell that owns one domain never reaches into another's adapters to
  build it.

### How a reference reads, in every state

`CellValue` renders a reference from a lookup the controls receive through
`ReferenceLabelsProvider` (a plain context; `react-controls` imports neither
TanStack nor `react-integration`). The `next-shell` fills it per page, cached per
`(entityKey, id)` under the target's own query scope, so a record's page reuses
what its list read.

| State       | Shows                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| resolving   | a line skeleton (as a `link` does today)                                                                                 |
| named       | the label, in the reader's locale if localized                                                                           |
| not found   | the entity noun and the short id, muted ("Offering product-…")                                                           |
| read failed | the same as not found; the region does not raise an alert for a label                                                    |
| no registry | the raw id, muted; the host is told the unregistered entity key once, to warn about (ADR 0013: a mechanism does not log) |

A list that loaded is not a failed list because one name could not be read: the
reader still gets something they can quote. That is why there is no alert per
cell.

### The same port, run the other way: related columns and related regions

A value that lives in another entity is read through the same machinery,
batched over the page's ids:

- **A related column** (`makeEntityCrud({ related })`) names a target entity, how
  it is matched (`via` a reference member of ours, or `match`, a member of the
  target holding our id), and the target member to show, rendered with the
  **target's** descriptor (a price reads as money). Zero matches read `—`; more
  than one read as a count ("3 prices"). A related column is never sortable or
  filterable: the value is in another store, and a sort the server cannot run
  would be a lie.
- **A related region** on a record page is the target entity's own list, held to
  the records that refer to this one by a fixed filter that is not a removable
  chip, with its own heading, its own states (ADR 0028) and its own writes.

**Record search reaches a reference the same way.** A record a person knows
by the record it refers to — a stock level by its product — is searched
through that reference: the term is matched against the referenced entity's
label at its owner, under the caller's own session, and the records referring
to the matches are read with one `=in=` and named by them. Two reads, one
after the other, and no index, for the reason the search has none. A search
result whose source declares no label member names itself by the derivation
above; one nothing names is sent by its short id for the caller to put the
noun to, never by its whole id.

**A record page that composes related regions is not master-detail.** Each
region writes its own record through its own owner, with its own Save. Rows a
record _owns_ stay a `composition`, edited in one write. Records that merely
_refer_ to it are regions. There is no page-wide Save, because there is no
transaction across stores to make one honest.

## Consequences

- `useLinkLabels`, `LinkLabelCell` and the label role of `links[].labelProperty`
  are deleted. `links` keeps only the picker's job. Every list a host built on
  `links` for labels moves to `references` plus the registry in the same
  adoption, with no compatibility path.
- Reading a page costs one request per **target entity**, not one per id. A page
  of 50 shipments naming 50 offerings goes from 50 requests to 1.
- An entity without a `labelMember` keeps a reasonable default, but no longer
  one that can land on a key.
- The register of who reads what grows a host-side table. A target the host never
  registered shows its id, and the host is told its key to warn about. It is not a
  silent `—`.
- Related columns cost one batched read each and are explicitly not sortable,
  which a reader may find limiting. The alternative is copying the value into
  the store that lists it, which is a projection with its own owner, and a host
  decision rather than a framework one.

## Alternatives considered

- **Make the member a `link`.** Rejected: the target's class would be imported
  across a domain boundary, and a `link` invites the storage join the store
  rule exists to forbid.
- **Denormalize the label into the referring record.** It works for a name that
  never changes, and it is the host's call when it wants one (a projection). As
  the default it would put a second writer on every name.
- **Keep per-id `get`s and add a cache.** The first page still costs one
  request per id, and nothing reaches the form, the dialogs or the breadcrumbs.

## Trigger

Promoted to **Accepted** by the change that lands `references`, `labelMember`,
`recordLabel()`, `ReferenceLabelsTag` with its repository-backed default,
`CellValue`'s five states under `ReferenceLabelsProvider`, and next-shell's
batched provider. Each state has a story under the gate of
[ADR 0024](0024-wcag-2-2-aa-and-the-gates-that-ratchet-to-it.md). Related
columns and regions land under the same record, in the release that ships them.
