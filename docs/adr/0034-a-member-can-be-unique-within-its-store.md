# 34. A member can be unique within its store

- Status: Proposed
- Date: 2026-11-26
- Revised: 2026-11-27 — a cell that writes through the driver ensures the indexes first, with `ensureEntityIndexes`
- Area: adapters
- Read when: a create answers `409 staleRevision` although nobody else saved first, two records hold a code a person types and should never share, a save is refused because "this already exists" and the form does not say which field, or about to check a value's uniqueness by reading before writing

## Context

A record often carries a value a person chooses and nobody else may hold: a
vendor's own SKU, a username, a code printed on a label. Until now entifix had
no way to say so. A host that needed it wrote its own index and its own
mapping, and a check-then-insert in a use case is not one: two requests
racing for one value both read "free" and both write.

The Mongo repository made the gap worse. A create that collided on **any**
unique index answered `StaleRevision`. That is right for the `id` index, where
the only way to collide is that someone created the same record first. It is
wrong for any other index. The person is told that someone else saved, and
loading the current record changes nothing. Their value is taken, and no
retry will succeed until they choose another.

`DuplicateKey {key}` already existed in core and was unused by the
repositories.

## Decision

### 1. `@accessor({ unique: true })` declares it, on the member

No two records of one store may hold the same value of a member declared
`unique`. The declaration sits on the member, beside `resetOnClone`. It is a
fact about the value, whichever verb writes it.

- It is legal on a `string`, `id` or `number` member only. A collection would
  be one index entry per element. A date or a boolean is never a key a person
  chooses. A localized text is several values at once. Describing the entity
  fails otherwise.
- **An absent value never collides.** An optional unique member can stay empty
  on any number of records.
- It implies `resetOnClone`: a copy that kept the value could never be saved.
- The descriptor carries `unique: true`, so the served `$metadata` says so.
- `uniqueMembersOf(entity)` names each one by its instance name, its stored key
  and its type. It includes hidden members, because a store enforces a value
  whether or not a screen shows it.

### 2. The store enforces it, never a read before the write

- **Mongo:** one partial unique index per member. It is named
  `unique_<storedKey>` and covers the documents whose value has the member's
  type, so absent and `null` are not indexed. The index is ensured lazily,
  once per database, beside the one on `id` and before **every** write. An
  update onto another record's value collides exactly as a create does.
  A cell that writes an entity's documents through the driver, inside a unit
  of work, calls `ensureEntityIndexes(db, Entity)` first: the repository's
  lazy ensure never runs on its path, and a fresh database would enforce
  nothing. `duplicatedKeyOf` reads which key a duplicate was on, so the body
  can tell a value already taken from the store failing.
- **SQL:** the host migration's `UNIQUE` column, since the adapter owns no
  DDL. Postgres admits any number of `NULL`s, which is the same rule.
  `23505` names the column from its `detail`.
- **In-memory:** the check runs in the same synchronous step as the write.

### 3. A collision names the member, and only `id` still means "someone saved first"

A collision answers `DuplicateKey {key: <storedKey>}`. The Mongo repository
keeps `StaleRevision` for a create that collides on `id` alone. The entity API
declares `DuplicateKey` on create and update for an entity with a unique
member, so it reaches a client as a `409` problem whose `key` names the field.

`EntityForm` shows that failure as the named field's error, "Another record
already has this SKU", in the error summary and on the input. The person sees
it next to what they have to change, not in a banner. A `key` that names no
field falls back to the banner.

### 4. One contract for every adapter

The repository contract gains a unique suite. It checks:

- a colliding create is refused with the stored key;
- an update onto another record's value is refused and writes nothing;
- a record keeping its own value saves;
- two absent values coexist;
- a value given up is free again;
- three creates racing for one value leave one winner.

It runs on the in-memory double, on Mongo over the fake driver (which now
reports the index's `keyPattern` and skips `null`, as a partial index does),
and on a real Postgres.

## Consequences

- A host declares the uniqueness and writes no index code. The value is unique
  per store, so a per-organization store makes it unique per organization for
  free.
- An existing collection holding duplicates of a newly unique member fails
  to build its index on first write. Nothing runs in production, so a host
  resets.
- A compound uniqueness (two members together) is not expressible. Nothing
  needs it yet. A store-specific index stays the host's for that case.
