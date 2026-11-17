# 32. A save names the revision it read

- Status: Proposed
- Date: 2026-11-16
- Area: adapters
- Read when: two people edit one record and the second save silently erases the first, a save answers `409 staleRevision`, an update arrives without a `revision`, a form or an autosaved draft has to keep what a record looked like when it was read, writing a verb or a host cell that changes a record a form may also be editing, or about to make a member `hidden` or `readonly` so that it stays off a form

## Context

Every write through the repository port is last-write-wins, and nothing in
the framework can tell that it happened.

- **Mongo**: `save` is `collection.replaceOne({ id }, { ...doc, id },
{ upsert: true })`
  (`packages/ts/mongo-client/src/adapters/make-mongo-repository.ts:114-138`).
  No collection has a unique index on `id`. The only `createIndex` calls in
  the adapter package are the idempotency store, the inbox, the outbox and the
  command inbox.
- **SQL**: `save` is `INSERT … ON CONFLICT (id) DO UPDATE SET` every column
  (`packages/ts/sql-client/src/adapters/make-sql-repository.ts:149-181`).
- **Static**: `save` and `delete` fail `Declined`. The source is read-only
  (`packages/ts/static/src/static-repository.ts:122-127`).
- **REST**: `save` picks `POST` when `entity.id == null` and the update method
  (`PUT`, or `PATCH`) otherwise
  (`packages/ts/rest-client/src/adapters/entity-rest/build-entity-rest-adapter-write/build-entity-rest-adapter-write.ts:47-55`).
  It resends one `Idempotency-Key` per instance until answered
  (`pending-save-keys.ts`).
- **The service shell**: the generic `update` reads the envelope, makes the
  path's id authoritative, runs `prepare`, and calls `saveUCFactory`
  (`packages/effect/service-shell/src/http-api/entity-api.ts:524-542`). Its
  declared errors are `NotFound` plus the host's (`:664-671`). It declares no
  `idempotent` unless an override does (`:673-675`).
- **The in-memory double** replaces by id
  (`packages/ts/testing-unit/src/doubles/entity-repository.ts:121-144`). The
  write contract asserts exactly that: "overwrites in place when saving an
  entity that already has an id"
  (`contracts/entity-repository.contract.ts:407-421`).
- **No member can be both on the wire and off the form.** The serializer and
  the deserializer skip every `hidden` or `readonly` member
  (`core/.../serializer/serialize.ts:83-88`, `deserialize.ts:108-115`). So a
  member a server owns and a client must return has no declaration today.

The first adopting host closed the races that mattered one verb at a time — a
stock hold's conditional `held` write, a shipment's conditional status write,
an order's `cancelling` claim. Those are races on a **state**. The race left
open is on a **document**: two people open one specification, both save, and
the first person's edit is gone without a sign. That host decided (in
r10c's ADR 0079 §4) that the check belongs in the framework, for every adapter, and
that it is a body member called `revision`. It also decided what is excluded:
quantities, status moves, projections and append-only records.

## Decision

### 1. An entity declares a revision member, and only then is its save checked

`@accessor({ type: 'revision' })` on a `number` member named `revision`
declares it. It is a new `MetaAccessorType`
(`core/.../meta-accessor/meta-accessor.ts:12-24`). Describing the entity
fails when:

- more than one member declares it;
- the member is not named `revision` (an `alias` is refused too, because the
  wire key is part of the contract);
- it is declared `required`, `filterable`, `sortable`, `hidden` or
  `readonly`;
- it is declared on a `composition` child — a child has no save of its own.

The checks sit beside the `parent` and `references` checks in
`describe-entity-columns.ts`.

**It is opt-in, by declaration.** An entity without it saves as it does today.
That is the exclusion path, and it is meant to be used:

- a **quantity or a ledger** is written with `$inc` over an append-only
  movement, never read-modify-written;
- a **projection** is ordered by its event's version;
- an **append-only record** is never updated.

None of those is a document a person edits, and a `revision` on one would be a
second ordering that agrees with nothing.

**It travels like a member and presents like nothing.** It is serialized
both ways (it is neither `hidden` nor `readonly`), so a list carries it per
row and a record carries it in its envelope. `describeEntityColumns` marks it
`presentation: 'none'`: a form keeps it in its draft and never renders a
field, a table never shows a column, a filter never offers it, and an
autosaved draft holds it beside the record. `cloneEntityDraft` clears it as it
clears the id (`reconstruct/clone-entity-draft.ts`), because a copy is a
create.

### 2. A save is a create or a conditional update, decided by the revision

For an entity that declares it, the port's `save`
(`business/src/repository/entity.repository.ts:29-40`) means:

| The entity holds                          | The adapter                                                                                                       | Answers                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| no `revision`                             | **creates**: writes `revision: 1`, minting an id if there is none, and **never overwrites** a record with that id | the entity at revision 1, or `StaleRevision` if the id exists |
| `revision: n`                             | **updates if the stored revision is `n`**, writing `n + 1` in the same statement                                  | the entity at `n + 1`                                         |
| `revision: n`, stored revision is not `n` | writes nothing                                                                                                    | `StaleRevision { entity, current }`                           |
| `revision: n`, no record with that id     | writes nothing                                                                                                    | `NotFound`                                                    |

An update is **one conditional write**, never a read and then a write. A
read-then-write lets two saves read `n` and both write.

### 3. The failure is typed, and it is an answer, not a race to retry

`StaleRevision` is defined in core beside the generic failures
(`core/src/failure/generic.ts`):

```ts
class StaleRevision extends defineFailure('conflict')<StaleRevision>()('StaleRevision', 'staleRevision', { entity: Schema.optionalKey(Schema.String), current: Schema.optionalKey(Schema.Number) }) {}
```

- **Category `conflict`, family `business`** — `409` by default, never
  retried, never trips a breaker
  ([ADR 0013](0013-failures-are-typed-values-decided-at-the-shell.md),
  [ADR 0014](0014-retry-once-at-the-layer-above-under-a-budget.md)). Not
  `contention`: a retry sends the same stale revision and loses again. Only a
  person who has seen the current record can make the save succeed.
- It joins `StoreFailure` (`generic.ts:182-183`) beside `DuplicateKey`. It is
  not a `StoreFault`, so a unit of work aborts on it rather than surfacing a
  store failure.
- It is declared in core, so every bundle that decodes a problem knows the
  code. A browser loads no service shell, and an unregistered code decodes as
  a protocol failure (the reason `NoActiveOrganization` sits there).
- `current` carries the stored revision, so a client can tell "changed since
  you read it" from "deleted since" (`NotFound`) without a second request.

What a form does with it — keep what was typed, say the record changed, offer
the current one, never retry by itself — is the next change's
(`react-controls`, `next-shell`), and it reads this failure by its code.

### 4. Each adapter's seam

The four adapters that check are Mongo, SQL, REST and the in-memory double.
Static only reads.

- **Mongo** (`make-mongo-repository.ts:114-138`):
  - create: `insertOne({ ...doc, id, revision: 1 })`, with a duplicate key
    translated to `StaleRevision`;
  - update: `replaceOne({ id, revision: n }, { ...doc, id, revision: n + 1 })`
    **without** `upsert`. A `matchedCount` of 0 is followed by one
    `findOne({ id })` to tell `NotFound` from `StaleRevision { current }`.
    That read only names the failure; the write already decided it.
  - A create is atomic only against a **unique index on `id`**, which no
    collection has today. The repository factory ensures `{ id: 1 }` unique
    once per collection per database, memoized, the way the outbox and the
    inbox ensure theirs. Without it, two concurrent creates with one client
    id both insert.
- **SQL** (`make-sql-repository.ts:149-181`):
  - create: `INSERT … ON CONFLICT (id) DO NOTHING RETURNING id`, where no row
    back means `StaleRevision`;
  - update: `UPDATE … SET …, revision = revision + 1 WHERE id = $1 AND
revision = $2 RETURNING revision`, where no row back is followed by one
    `SELECT revision` to tell the two failures apart.
  - The table needs a `revision integer NOT NULL` column. The adapter does not
    own entity DDL, so that is the host's migration.
- **Static**: unchanged. It still refuses `save` with `Declined`. It reads
  `revision` when a record carries it, and since the member is never
  `required`, content without one still validates. A read-only source has no
  update to check.
- **REST** (`build-entity-rest-adapter-write.ts:47`): for a declared entity,
  the create test becomes `entity.revision == null` instead of
  `entity.id == null`, so a client-minted id is sent with `POST` rather than
  as a `PUT` that the service would refuse (§5). The `revision` rides in the
  envelope, and a `409` decodes to `StaleRevision` through the shared problem
  codec. Undeclared entities keep the id test.
- **The in-memory double** (`testing-unit/src/doubles/entity-repository.ts:121-144`)
  implements the table in §2. It is what most host specs run against, and the
  contract holds it to the adapters.

### 5. The service shell refuses an update that names no revision

In `entityApi`'s generic `save` (`entity-api.ts:524-542`), for a declared
entity:

- **`update` without a `revision`** fails before `prepare` with `Invalid`
  (`400`, code `invalid`), carrying one field problem:
  `{ pointer: '/data/revision', code: 'required' }`. It is never treated as a
  create and never as an overwrite.
- **`create`** discards any `revision` in the body. The server owns the first
  one.
- `prepare` sees the revision and must not change it. A `prepare` that sets
  one is a defect the contract below plants.
- `StaleRevision` is added to the declared errors of `create` and `update`
  (`:664-671`), so the served contract and the OpenAPI document state the
  `409`.
- **`create` and `update` declare `idempotent`** (`:673-675`, which today
  takes it only from an override). A save that landed but whose response was
  lost is retried by the REST adapter under the same `Idempotency-Key`, and
  the service replays the first answer instead of refusing the old revision
  with a `409`.
- Overrides and `@useCase()` verbs write through their own handlers and are
  not checked by the shell (§6).

### 6. A verb need not name a revision, but it moves one

A verb (`publish`, `dispatch`) is a state move. It keeps its one conditional
write on the state it leaves ([ADR 0029](0029-a-verb-declares-the-states-it-is-legal-from.md)),
and it is not refused for a revision its caller never read. But a verb that
changes a record which declares a revision **increments that revision in the
same write**. Otherwise a form opened before the verb saves over the verb's
result at the old revision, and the check protects nothing.

Core exports `bumpRevision` for Mongo (`{ $inc: { revision: 1 } }`) and a SQL
fragment, so a host's conditional write states the increment rather than
re-deriving it. The framework cannot see a host cell's write, so the rule is
asserted by that host's own check.

### 7. The contract holds every adapter to it

`describeEntityRepositoryRevisionContract` in `@entifix/testing-unit` runs
against a `RevisedWidget` that declares the member. `ContractWidget` stays
undeclared, and the existing "overwrites in place" test keeps describing the
unchecked path.

What it asserts:

- a create answers revision 1;
- a create over an existing id answers `StaleRevision` and leaves the record
  unchanged;
- an update at `n` answers `n + 1`;
- a second update at `n` answers `StaleRevision` with `current: n + 1`;
- an update of a missing id answers `NotFound`;
- a delete is not checked;
- **two concurrent updates at `n` produce exactly one success.**

Where it runs:

- the in-memory double;
- Mongo, over `makeFakeMongoDb`, whose `replaceOne` already honours the filter
  and whose `insertOne` honours unique indexes (`fake-mongo.ts:546-573`);
- REST, over `entityRestHandlers` (`http/entity-handlers.ts:97-110`), whose
  `PUT` replaces unconditionally today and learns the same rule;
- SQL, against a real Postgres. `fake-sql` records statements and executes
  none, so it can assert the SQL text but not the race.

A service-shell spec covers the rest:

- an update without a revision answers `400`, with the pointer;
- a stale update answers `409` with `code: 'staleRevision'`;
- a `prepare` that rewrites the revision is caught.

## Consequences

- **Breaking, in three places a host sees.**
  1. The meaning of `save` for a declared entity: it is no longer an upsert,
     and a create never overwrites.
  2. `StoreFailure` has a new member, so an exhaustive match on it stops
     compiling.
  3. The generic `update` refuses a body without `revision`.

  It ships as a breaking minor (0.23.0, under ADR 0003's channel rule). An
  undeclared entity behaves exactly as before.

- **A seed that saves fixed ids twice now fails the second time** for a
  declared entity. A seed of a declared entity creates, and treats
  `StaleRevision` on create as "already seeded", which is the behaviour a seed
  wants.
- **A retried save does not lose to itself.** The generic `create` and
  `update` of a declared entity now need the idempotency store the service
  shell already provides to `idempotent` endpoints. A host serving one
  without that store is a missing requirement at compile time, not a failure
  at the first retry.
- Every list row, envelope and draft carries one more number, and every host
  migration of a declared SQL entity adds a column.
- A Mongo collection of a declared entity gains a unique index on `id`. It is
  created lazily and costs nothing a create did not already pay for.
- **Not decided here:**
  - conditional **delete** (`DELETE` has no body, and a stale delete is a
    separate question);
  - the form's conflict state (the next change);
  - what a flow does with `StaleRevision` mid-flight. It is business, so
    it is never retried; whether it compensates or fails the flow is the
    host's flow design.

## Alternatives considered

- **`If-Match` and an `ETag`.** The HTTP-native answer. Rejected for the
  reasons the adopting host recorded:
  - every same-origin proxy must forward the header both ways;
  - a list row has no `ETag` of its own;
  - a header reaches neither an autosaved draft nor a flow step. A body
    member reaches all three.
- **On by default, with an opt-out.** It fails closed, which is entifix's usual
  direction. Rejected for now because an entity class holds its state in
  private fields: the framework cannot add a member a class did not declare,
  so "default-on" would mean every entity in every adopter must declare one,
  ledgers and projections included, before it compiles. The adopting host's
  own check (every authored entity declares it) closes the gap where the
  knowledge lives.
- **Read, compare, then write.** Two saves read `n` and both write. Only one
  conditional statement is a check.
- **`contention` instead of `conflict`.** A retry cannot win, so the
  retryable category would loop until the budget ran out and then say the
  wrong thing.

## Trigger

Promoted to **Accepted** when:

- the release that declares `type: 'revision'` ships, with `StaleRevision`,
  the seams of Mongo, SQL, REST and the in-memory double, the shell's `400`
  and the idempotent `create` and `update`;
- the revision contract runs green against the in-memory double, Mongo (fake
  driver) and REST, and against a real Postgres;
- an adopting host shows, on a live fleet, that a second save at one
  `revision` answers `409 staleRevision` while the first one's edit survives.

## Decisions confirmed (2026-11-17)

1. **The fourth adapter is the in-memory double** (§4). Plan 2.1 named
   static, which refuses every write by design. Static only reads `revision`
   and never requires it.
2. **A missing `revision` answers core's `Invalid`** (`400`, code `invalid`,
   field problem at `/data/revision`; §5). `invalidBody` is r10c's own code,
   and r10c's ADR 0079 §4 is corrected in place to match.
3. **The generic `create` and `update` are idempotent** for a declared entity
   (§5), so a lost response replays rather than answering `409`.
4. **A status verb increments `revision`** in its own conditional write (§6).
   It is never refused for one, but it moves it.
5. **Opt-in by declaration** (§1). The adopting host's own check decides which
   entities are authored. The release is still breaking for the three reasons
   in Consequences.
6. **The repository factory ensures Mongo's unique index on `id` lazily**, per
   collection and per database (§4).

Carried as written, not raised separately:

- the REST create test becomes `revision == null` for declared entities (§4);
- the SQL race is proved in `@entifix/sql`'s existing `test-integration`
  target against a real Postgres (§7).
