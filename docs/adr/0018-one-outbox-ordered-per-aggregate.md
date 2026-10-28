# 18. One outbox for every domain event, ordered per aggregate

- Status: Accepted
- Date: 2026-10-28
- Area: adapters
- Read when: emitting a domain event from a write, consuming an event that may arrive out of order, an event stuck at the head of the outbox delays unrelated ones, writing an outbox on a new engine, or about to reach for change data capture

## Context

The outbox is named for transactions (`TransactionOutbox`,
`packages/ts/transactions/src/contracts/outbox.ts`) and keyed only by `eventId`.
The Mongo relay drains it **globally oldest-first** and stops at the first
failure (`packages/ts/mongo-client/src/outbox/relay.ts`), so one entry that
cannot publish delays every aggregate behind it until it is quarantined. Events
carry no version, so a consumer cannot tell a late, older event from a new one,
and projectors order on whatever timestamp the payload happens to carry. And
the outbox exists only on Mongo, while the workflow store of
[ADR 0016](0016-a-flow-engine-port-and-a-durable-workflow-adapter.md) is
Postgres.

## Decision

### One shape, one name

`Outbox`, collection or table `outbox`. Every entry carries:

- `eventId` — still the unique dedup key;
- `aggregate { type, id }` — what the event is about;
- `version` — that aggregate's version the event describes;

indexed on `(aggregate.type, aggregate.id, version)`. `unit.emit` requires the
aggregate and the version: an event without them cannot be written.

### Drained per aggregate

The relay keeps order **within an aggregate** and nowhere else. A failing or
quarantined head blocks only its own aggregate; every other aggregate keeps
draining. Global order was never a guarantee a consumer could use — the bus does
not keep it across queues — so nothing is lost by dropping it.

### Consumers discard what is stale

An inbox helper, `discardIfStale(aggregate, version)`, lets a consumer drop an
event older than the last version it applied. With a version per aggregate, a
late `v = n-1` never overwrites `v = n`, and a delete is ordered like any other
write.

### The same contract on every engine

One `outboxContract` suite, in `@entifix/testing-unit`, covers per-aggregate
order, a poisoned aggregate not blocking another, the stale-version discard and
a duplicate enqueue. The Mongo store runs it over a fake driver; the SQL store
runs it too, draining with `FOR UPDATE SKIP LOCKED` so several runners never
publish one entry twice.

### The polling relay stays; change data capture is rejected

A change stream or a logical-replication slot would remove the polling. It
would also add a resume-token store that must itself be durable, an oplog or
WAL retention window that a long outage silently outruns, and a second path
from a write to the bus that the unit-of-work contract does not cover. The
polling relay costs a query per interval, and the interval is a dial.

## Consequences

- A projection is correct under redelivery and reordering by construction, not
  by the order a broker happened to deliver in.
- `TransactionOutbox` and the `transaction_outbox` collection are renamed;
  there is no compatibility alias.
- [ADR 0009](0009-a-unit-of-work-the-outbox-inbox-and-command-claim-join.md)'s
  unit of work gains a SQL implementation holding state, outbox and command
  claim in one transaction.
- **Check:** `outboxContract`, run by every outbox implementation.
