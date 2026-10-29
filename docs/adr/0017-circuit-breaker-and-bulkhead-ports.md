# 17. Circuit breaker and bulkhead ports, with per-process engines

- Status: Accepted
- Date: 2026-10-28
- Area: platform
- Read when: a failing dependency drags down its callers, a consumer quarantines messages during an outage, sizing how many concurrent calls a participant may take, or about to write a breaker or a semaphore by hand

## Context

Nothing in entifix isolates a failing dependency. The only in-process retry was
the saga runner's post-pivot loop, and a bus consumer whose dependency is down
nacks every delivery until its ceiling, turning an outage into quarantined
messages (`packages/ts/amqp-client/src/adapters/amqp-event-bus.ts`). The retry
budget of [ADR 0014](0014-retry-once-at-the-layer-above-under-a-budget.md)
limits how much a retry adds; it does not stop the first attempts from piling
up on a dependency that is already down.

## Decision

### Ports at `.`, engines at `/engine`

`@entifix/transactions` `.` declares two ports:

- `CircuitBreakerTag` — `guard(key)(effect)` and the state for a key;
- `BulkheadTag` — `withPermit(key)(effect)`.

Keys are **per participant**, optionally narrowed by route. The per-process,
in-memory engines sit at `@entifix/transactions/engine`, beside
`InMemoryRetryBudgetLayer`, and take their dials from the composition root.

### The breaker follows Resilience4j's model

States `CLOSED`, `OPEN`, `HALF_OPEN`, plus `FORCED_OPEN` and `DISABLED` for an
operator. Dials: a count- or time-based window, a failure-rate and a slow-call
threshold, a low minimum number of calls, the wait in open, and the permits in
half-open. A `429` or `503` carrying `Retry-After` **trips immediately**,
because the dependency has said it is overloaded.

### What the breaker records

Only the **technical** family of
[ADR 0013](0013-failures-are-typed-values-decided-at-the-shell.md), **minus
`protocol`**. A business failure is an answer and never trips a breaker; a
protocol failure is a bug on one side and would not get better by waiting. An
open breaker answers `unavailable` with `reason: breakerOpen` and
`retryable: false`, so nothing above it retries into it.

### The bulkhead

A semaphore per key. A full bulkhead answers `exhausted`.

### Bounds on every call

A per-attempt timeout and a whole-step bound wrap each guarded call. The retry
budget is reused, not duplicated.

### Consumers pause while a breaker is open

A subscription may name `pauseWhileOpen: [breakerKey]`. While that breaker is
`OPEN` or `FORCED_OPEN` the consumer stops consuming, and it resumes on
`HALF_OPEN`. A delivery refused mid-flight is requeued without counting where
the broker allows it. An outage then leaves messages waiting on the queue, not
in quarantine.

### Observability

A state gauge per key, transition counts, rejected calls, the bulkhead in use,
and a paused gauge per queue.

## Consequences

- The workflow interpreter of
  [ADR 0016](0016-a-flow-engine-port-and-a-durable-workflow-adapter.md) wraps
  every Activity call in the breaker, the bulkhead and the budget, so a flow
  before its commit point fails fast and compensates, and a flow after it
  suspends rather than hammering a dependency that is down.
- The engines are per process. A fleet-wide breaker would need shared state and
  a store on the hot path; per-process state converges within a window and
  costs nothing.
- **Checks:** a `breakerContract` suite covering every transition, the slow-call
  trip, the `Retry-After` trip, the forced states and a full bulkhead; a fake
  channel proving an open breaker delivers nothing and quarantines nothing.
