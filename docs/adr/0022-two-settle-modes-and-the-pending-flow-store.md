# 22. One mutation API, two settle modes, and a pending-flow store

- Status: Accepted
- Date: 2026-11-02
- Area: ui
- Read when: a write answers `202`, building an optimistic update, a pending state has to survive a reload, a flow's failure has to reach the user, showing money as taken before it is, or about to poll a status route from the browser

## Context

The REST save adapter (`build-entity-rest-adapter-save.ts`) treats a `202` as a
hand-off to a transaction tracker. It checks the body's shape, discards it, and
reports a transaction id to a sink. The browser then settles that id by polling
the tracker (`use-transaction-settlement.tsx`).

Durable flows ([ADR 0016](0016-a-flow-engine-port-and-a-durable-workflow-adapter.md))
answer `202 flowAccepted`, with a `flowId` and its links, and announce their
outcome as `flow.completed` or `flow.failed`. Server push
([ADR 0021](0021-server-push-and-the-multiplexed-channel.md)) can carry that
outcome to the tab that started the flow. What is missing is the client contract
that joins the two, and one place where an asynchronous failure becomes
translated copy.

## Decision

### The server picks the mode, and the client has one API

A save, a delete or a verb call returns one of two results:

- **`Settled<T>`** on `200` or `201`: the write happened, and the body is the
  entity. The client behaves as a TanStack Query optimistic mutation: apply on
  mutate, roll back on failure.
- **`Pending`** on `202`: the body decodes as `flowAccepted`. The client keeps
  the optimistic state in a **pending** status, keyed by `flowId`, until push or
  catch-up settles it.

Anything else decodes as a failure, through the same codec every other response
uses ([ADR 0013](0013-failures-are-typed-values-decided-at-the-shell.md)).
`useOptimisticMutation({ apply, rollback })` is the one hook for both modes. A
screen never branches on a status code.

Where the two modes are answered:

- `WriteResult<T>`, `Settled<T>` and `Pending` live in core, so a port can name
  them. `EntityUseCaseRunner.run` answers a `WriteResult`.
- `buildEntityRestAdapterWrite` is a screen's save and delete over REST, and
  sends an update as `PUT` or `PATCH` by the `update` option.
- The repository's `save` keeps answering the stored entity, because the Mongo
  and SQL adapters share that port and a pending write has no entity to return.
  The REST one refuses a `202 flowAccepted` and names the write adapter.
- A flow's `status` link answers a `flowStatus` envelope: its state, and the
  failure it ended with. `buildFlowStatusReader` reads it, and a `404` reads as
  _not projected yet_.

### Pending flows have their own store

- `PendingFlowStore` is a port. It holds `{ v, flows }` and nothing that is not
  JSON. Each entry is `{ flowId, intent, createdAt, topic }`.
- The host injects the storage and scopes it per principal. An **anonymous**
  scope holds flow ids only, never an intent that could carry personal data.
- A stored `v` that differs from the current one is discarded, not migrated.
  This is a cache of in-flight work; losing it costs a re-read.
- A value that is not JSON is rejected at write time, not at read time, so a
  broken entry never reaches storage.

### Settling

- `usePendingFlowSettlement` subscribes `flow:<flowId>` for every pending entry.
  - `flow.completed` confirms it, by applying the pushed snapshot (version-guarded
    `setQueryData`) or by invalidating the affected queries for a hint.
  - `flow.failed` rolls back and emits **exactly one** toast event, carrying the
    decoded failure.
- On connect and on resync, it re-reads each entry's status link. A `404` means
  _not projected yet_, never _failed_: the entry stays pending, up to a
  bounded-age dial, and is dropped after that.
- Failures render through the host's error translator, in a toast region the
  host mounts once. The hook hands each failure to the host's `onFailure`, and
  a flow that aged out settles as failed with no failure, so nothing is
  toasted for it.

### The money rule

A `Pending` result exposes `pending`, `confirmed` or `failed`, and nothing else.
The client never shows a payment as captured, a reservation as held or an order
as placed on the strength of a `202`. Only the flow's own outcome says so.

### A pending create stays on its form

A create that answers `202` keeps the user on the form, in a pending state, until
it settles. A failure shows one toast, and the form keeps its input. Navigating
to a record that may never exist would show a `404` for a write that failed.

## Consequences

- One hook covers a synchronous save and a multi-step flow. The server can move
  a write from one mode to the other without the screen changing.
- A tab closed mid-flow settles on its next load, through catch-up, rather than
  showing a write as forever pending.
- The legacy tracker path (`TransactionSinkTag`, the transaction-status reader
  and `useTransactionSettlement`) stays beside this until the release that
  deletes the saga runner. It is reached only through the `command` create
  protocol of the repository's REST `save`, so the two `202` bodies never meet
  on one call.
- **Checks:**
  - a `200` followed by a typed failure rolls back and leaves no store entry;
  - a `202` persists, survives a reload (fake storage), and settles on push and
    on catch-up after a missed push;
  - an older `v` is discarded and a non-JSON value is rejected at write;
  - `flow.failed` produces exactly one toast event;
  - a failed pending create shows one translated toast and keeps the form's
    input.
