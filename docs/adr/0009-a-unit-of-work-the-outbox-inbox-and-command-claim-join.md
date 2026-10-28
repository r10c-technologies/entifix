# 9. A unit of work the outbox, inbox and command claim join

- Status: Accepted
- Date: 2026-10-25
- Revised: 2026-10-28 by [ADR 0013](0013-failures-are-typed-values-decided-at-the-shell.md) — the store failing is a technical-family failure (`unavailable`, `timeout`, `contention`), not `EntifixConnError`; a business-family failure is still the abort
- Revised: 2026-10-28 by [ADR 0018](0018-one-outbox-ordered-per-aggregate.md) — the outbox is `Outbox`, keyed by aggregate and version and drained per aggregate; the unit of work gains a SQL implementation; the saga runner, lock and sequence ports it sat beside are removed by #127
- Area: adapters
- Read when: a write has to announce itself on the bus, a consumer has to fold a message exactly once, or a participant has to answer a redelivered command with what it decided the first time — and you are about to open a driver session by hand to make two of those one fact

## Context

The outbox, the inbox and the command claim each only work **inside the
storage transaction of the write they guard**. An event recorded after its
write can be lost between the two; a claim taken before its side effect can be
taken by a run that then crashed, and the redelivery is skipped forever.

The ports said so and then declined to help. `TransactionOutbox.enqueue` and
`TransactionInbox.claim` took no transaction, deliberately: a driver session
must not enter a framework-free contract. So every write that had to be atomic
with its event, and every fold that had to be atomic with its claim, opened a
session itself, inserted `outboxDocument(...)` or `inboxDocument(...)` by hand,
and caught its own duplicate-key error to tell a redelivery from a failure.

Measured in the first consumer: seven write sites and three folds did this, a
participant's command claim was copied verbatim into three services, one site
built the outbox entry by hand instead of through `outboxDocument`, and refusals
left those transactions as thrown sentinel classes caught several frames up.
Each copy was a place to get the order of operations wrong.

The refusal had the right reason and the wrong conclusion. The driver session
must stay out of the contract; that does not mean the transaction has to.

## Decision

`@entifix/transactions` declares a **unit of work**: one storage transaction
that domain writes, zero or more events and at most one claim all join, and
that commits or vanishes as a whole.

```ts
unitOfWork.run(unit => body(unit.handle, unit.emit), { claim, replay, afterCommit });
// → committed { value } | duplicate { replay } | aborted { reason }
```

### The handle is opaque

`UnitOfWork<H>` is generic in its handle. The contract never says what `H` is;
the adapter does (`{ db, session }` for Mongo). Only the adapter and the
persistence code written against it look inside, which is exactly where the
session already lived. A use case that runs a unit names no driver.

### Three outcomes, and a store failure is none of them

- `committed` — the writes, the events and the claim are durable.
- `duplicate` — the claim was already taken. The body **did not run**. A
  `command` claim carries what the first run asked to be remembered, because a
  redelivered command must be told what was decided, not merely that something
  was.
- `aborted` — the body failed with a business reason. Nothing was written.

The body's typed failure **is** the abort. A technical-family failure is the
one exception: the store failing is not a business decision, so it rolls back
and surfaces as the run's own error
([ADR 0013](0013-failures-are-typed-values-decided-at-the-shell.md)).

### Two claims, keyed differently

An `event` claim is keyed on `(consumer, eventId)`, the inbox's compound key: two
consumers legitimately fold one event. A `command` claim is keyed on the command
id alone, because a command has one addressee. An event id already in the
outbox is treated as a duplicate as well — it is the outbox's own idempotency
claim.

### The body is retry-safe, by contract

An adapter may re-run a unit on a transient conflict, from the start. So the
body must be a function of its inputs and the handle: no clock read whose value
was already returned, no call to another service, no counter drawn from outside
the store. Those happen before the unit and are passed in. This is the rule the
driver's own transaction callback already imposed, now stated where a reader
looks.

### `afterCommit` is the fast path

It runs once, only on commit, and its failure changes nothing — the outbox
still holds the event and the relay's sweep is the fallback. Draining the
outbox there is what makes an event leave when its transaction commits rather
than at the next sweep.

### What stays

`Outbox` and `TransactionInbox` keep their standalone `enqueue` and `claim` for
the code that can use them outside a transaction. The outbox's shape and drain
order are [ADR 0018](0018-one-outbox-ordered-per-aggregate.md)'s, and the unit of
work has a SQL implementation beside the Mongo one, so a Postgres store joins
state, outbox and command claim in one transaction too.

## Consequences

- A consumer writes a fold as a body plus a claim and gets redelivery, rollback
  and duplicate detection from one place, with one test suite
  (`describeUnitOfWorkContract`) holding every adapter to the same behaviour.
- The in-memory unit and the Mongo driver fake model **atomicity, not
  isolation**. A race between two units is green under both no matter what the
  code does; it is proven against a real store or not at all.
  Measured against a real single-node replica set before this shipped: eight
  units incrementing one document at once committed only one of eight under a
  fixed three-attempt retry, with the other seven misread as business aborts
  because the body had not wrapped the driver's error. The adapter now finds the
  `TransientTransactionError` label anywhere in the cause chain and retries
  with a jittered back-off — eight of eight — and six units racing for one
  command id commit exactly one and answer five as duplicates.
- A replica set (or another store with multi-document transactions) is a
  requirement of any adapter, not an option of it.
