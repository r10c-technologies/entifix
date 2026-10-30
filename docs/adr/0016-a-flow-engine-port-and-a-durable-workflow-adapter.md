# 16. A flow engine port, and a durable workflow adapter that interprets the pinned slip

- Status: Accepted
- Date: 2026-10-28
- Revised: 2026-10-29 by the #119 interpreter — `signalCorrelated`, an explicit compensation walk, and `DurableDeferred.raceAll` for timed waits
- Revised: 2026-10-29 — step bounds are overridable per participant (`dialsFor`), and journaled states are counted
- Area: adapters
- Read when: running a multi-step flow, deciding where a flow survives its process dying, adding a wait, a child flow or a join to a flow, bumping the `effect` pin, or about to import `effect/workflow` or `effect/cluster`

## Context

The saga runner (`packages/ts/transactions/src/engine/run-saga.ts`, with
`resume-sweep.ts` and `run-transaction.ts` beside it) is entifix's own
orchestration engine. It interprets a `SagaDefinition` imperatively, keeps its
own compensation bookkeeping, retries after the pivot in a hand-written loop
(`run-saga.ts:290-320`), and survives a crash only because a host-run sweep
resumes instances from their stored record. It has no waits, no child flows and
no joins, and the routing slip of
[ADR 0015](0015-composed-flows-and-use-case-resolution.md) needs all three: a
cash-on-delivery order waits days for a courier, and a refused delivery starts a
refund as a flow of its own.

`effect` 4 ships a durable workflow engine (`effect/workflow`) and a sharded
runtime for it (`effect/cluster`: `ClusterWorkflowEngine`, `SqlMessageStorage`,
`SqlRunnerStorage`, `SingleRunner`, `SocketRunner`). Every one of those modules
is marked `@stability unstable`, and `ClusterWorkflowEngine` had four
concurrency defects between September and October 2026, all closed before
4.0.6.

## Decision

### A port in `@entifix/transactions`, an adapter in a new package

`FlowEngineTag` sits at `@entifix/transactions` `.`:

- `start(slip, idempotencyKey) → { flowId }`, idempotent on the key;
- `status(flowId)`, `signal(flowId, token, outcome)`, `interrupt(flowId)`;
- `signalCorrelated(correlation, token, outcome)`, for a sender that knows what
  a wait is correlated with — the order a delivery follows — and not the flow;
- typed failures.

There is deliberately **no `await`**. A caller settles by push, from the
`flow.*` events below, never by holding a request open on a flow.

The durable adapter is a new **tier-2** package, `@entifix/workflow`, over
`effect/workflow` and `effect/cluster`. Its storage and its runner transport are
**optional peers behind subpaths**, as
[ADR 0001](0001-the-tier-contract-and-the-host-seam.md) requires of any
capability a tier must be adoptable without:

| Subpath                           | Optional peer           |
| --------------------------------- | ----------------------- |
| `@entifix/workflow/postgres`      | `@effect/sql-pg`        |
| `@entifix/workflow/socket-runner` | `@effect/platform-node` |

**`effect/workflow` and `effect/cluster` are imported nowhere else.** The
unstable surface is contained in one package, so an `effect` bump that changes
it changes one package.

### One interpreter over the pinned slip

The adapter holds one generic interpreter — one `Workflow.make` whose payload is
the slip, branching on `slipVersion` — not one workflow per flow:

- **Each step is an `Activity`** named `segment:step`. Its idempotency key,
  `<flowId>:<step>`, travels to the participant as `Idempotency-Key`.
- **Before and at the commit point**, a refusal undoes the steps that
  succeeded, in reverse, each undoing an Activity of its own keyed
  `<flowId>:<step>:compensation`, and the flow ends `compensated`; a fan-out
  undoes only the calls that succeeded. The walk is explicit rather than
  `Workflow.withCompensation`, because a failing undoing has to stop the flow
  `failed` at that step, and a finalizer cannot say which step it was.
- **At and after the commit point**, a step runs under `SuspendOnFailure` with a
  `suspendedRetrySchedule`. A step is bounded per attempt and as a whole; past
  the whole-step bound the flow strands with `flow.suspended` and alerts. Both
  bounds are dials with a host default, and `dialsFor(participant)` overrides
  them per participant — a payment provider and a stock ledger do not answer on
  the same clock, and one bound for both is wrong for at least one of them.
- **Waits** are a `DurableDeferred`, addressable through `signal` or, by the
  step's `correlation` parameter, through `signalCorrelated`. A wait that names
  a timeout races the deferred with `DurableClock.sleep` through
  `DurableDeferred.raceAll`, whose winner is journaled — a plain
  `Effect.raceFirst` inside a workflow re-runs the race on resume and can pick
  the other branch.
- **Child flows** are correlated by the order id; **per-vendor joins** run a
  stage's segments at once, bounded by a `concurrency` dial, before a shared
  pivot, and the earliest failing step decides.
- **No retry outside the Activity.** Each call is wrapped by the breaker, the
  bulkhead and the retry budget of
  [ADR 0017](0017-circuit-breaker-and-bulkhead-ports.md) and
  [ADR 0014](0014-retry-once-at-the-layer-above-under-a-budget.md).

### Flow events leave through an outbox

`flow.started`, `flow.completed`, `flow.failed` and `flow.suspended` are written
by an idempotent `announce` Activity into a **SQL outbox** in the workflow
store, with event id `<flowId>:<step>`, `correlationId = flowId`, the flow as
aggregate and the step ordinal as version. They reach the bus through the relay
of [ADR 0018](0018-one-outbox-ordered-per-aggregate.md), like any other domain
event.

Every state the interpreter journals is also counted, as
`entifix_flow_states_total` by state and source, inside the Activity that
records it — so a replay never counts twice, and `suspended` is a series a host
can alert on without reading the outbox.

### Gates every interpreter change and every `effect` bump

- **A chaos suite** runs against a real Postgres with two `SocketRunner`
  processes: a deferred completed during suspension, a durable race with a
  parked sibling, a runner killed mid-step and resumed once on the other, resume
  after a full restart, a double delivery of an Activity result, a concurrent
  `start` with one key.
- **Journal replay**: a recorded journal per `slipVersion` replays to the same
  command sequence, and a `slipVersion` with no journal fails.
- CI runs both on every change to `packages/ts/workflow` and on every change to
  the `effect` pin.

### A host runs at least two runners

Every host runs **≥ 2 runners**, so a runner dying is the normal case the
engine is exercised under rather than a disaster path tested once.

## Consequences

- The tier register gains `@entifix/workflow` at tier 2 with the two optional
  peers above; a hard dependency on `@effect/sql-pg` fails `@entifix/tiers`.
- The saga runner, the resume sweep and the single-step engine have no
  successor in entifix once a host has moved; they are deleted in
  [#127](https://github.com/r10c-technologies/entifix/issues/127).
- A fake in-memory engine with compensation and suspension semantics, and a
  `flowEngineContract` suite every adapter runs, sit in `@entifix/testing-unit`.
- **Checks:** an import-containment lint for `effect/workflow|cluster` with a
  planted violation, `flowEngineContract`, the chaos suite and the replay spec.
- **Accepted risk:** the engine is `@stability unstable`. The containment and
  the two gates are what make that acceptable; dropping either is a reason to
  revisit this record.
