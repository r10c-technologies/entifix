# 14. Retry once, at the layer directly above the failure, under a budget and a deadline

- Status: Accepted
- Date: 2026-10-28
- Area: platform
- Read when: adding a retry, a backoff or a `Schedule` to a call, sizing a queue's `maxAttempts`, an outage gets worse when its dependency comes back, a request keeps working after its caller gave up, or about to retry inside a bus consumer

## Context

Retries happened at three layers, none of them sized against the others:

- **The saga coordinator** retried a step after the pivot with a hand-written
  loop (`POST_PIVOT_RETRIES = 3` in `packages/ts/transactions/src/engine/run-saga.ts`).
- **The bus** redelivered a failed message up to the queue's
  `x-delivery-limit`.
- **The browser** let TanStack Query retry a failed read three times by default.

A call that failed at the bottom of that stack could be attempted 3 × 5 × 4
times, and nothing stopped a fourth layer — a handler wrapping its own
`Effect.retry` — making it more. Google's SRE book names this exactly: retries
at every layer multiply, and under overload the multiplied load is what keeps a
recovering dependency down ("Handling Overload", "Addressing Cascading
Failures", _Site Reliability Engineering_, ch. 21–22).

No deadline travelled either. A request whose caller had given up kept working —
and kept retrying — on every hop below it, spending capacity on an answer
nobody would read.

[ADR 0013](0013-failures-are-typed-values-decided-at-the-shell.md) makes the
retry decision possible to state: a business failure is an answer and is never
retried, a technical one may be. This record says who retries, how often, and
until when.

## Decision

### One layer retries: the one directly above the failure

A failure is retried by the layer that called the thing that failed, and by no
one above it. Everything above sees the final outcome. In this framework that
means:

- **A coordinator retries a participant.** The participant does not retry its
  own datastore on the coordinator's behalf.
- **A bus consumer's only retry is redelivery.** A handler never wraps itself in
  `Effect.retry`; the queue's `x-delivery-limit` is its retry, and the host
  sizes it.
- **The browser does not retry.** `QueryProvider` defaults `retry: false`. The
  service it called already retried what was worth retrying.

### At most three attempts, under a per-dependency budget

In-process retries go through `On(predicate).retry(schedule)` and draw from a
`RetryBudgetTag` keyed **per dependency and per organization**:

| Dial                       | Default | Meaning                                                               |
| -------------------------- | ------- | --------------------------------------------------------------------- |
| `maxAttempts`              | 3       | attempts per call, the first included                                 |
| `budgetRatio`              | 0.1     | retries may add at most 10% to a dependency's first-attempt rate      |
| `budgetFloorPerSecond`     | 1       | retries admitted regardless of ratio, so a quiet dependency can retry |
| `backoffBaseMs`            | 50      | first backoff                                                         |
| `backoffCapMs`             | 2000    | largest backoff                                                       |
| `adaptiveThrottlingK`      | 2       | client-side throttling multiplier; `0` turns it off                   |
| `adaptiveThrottlingWindow` | 120 s   | the window throttling counts requests and accepts over                |

Backoff is exponential with **full jitter** — a uniform draw between zero and
the capped exponential — so callers that failed together do not retry together.
Adaptive throttling is the SRE book's client-side rule: once requests exceed `K`
times accepts over the window, the client rejects locally with probability
`max(0, (requests − K·accepts) / (requests + 1))` instead of sending.

The port sits at `@entifix/transactions` `.`, in tier 2, so anything that
orchestrates calls — today a coordinator, later a workflow interpreter — can
reach it. Its in-memory token-bucket engine is at `@entifix/transactions/engine`,
which is already banned in cells: a host chooses the engine at composition.
Attempts and budget rejections are OTel metrics per dependency; they are not
logged, because the shell's log table is the only logger.

### What may never be retried, checked before it can happen

`On(p).retry` refuses **when the layer is built**, not when it runs:

- a call not marked idempotent — retrying a non-idempotent write is a second
  write. An idempotent call either carries an `Idempotency-Key` or is a read.
- a predicate that admits the business family — a type error, and a runtime
  guard behind it for predicates built dynamically.
- `timeout` on a non-idempotent call, because a timed-out write may have
  happened.

Two failures stop retries wherever they appear: `Overloaded` (the dependency
asked for less load) and an open breaker.

### The deadline travels as a remainder

A request carries **`x-request-timeout-ms`**: the milliseconds its caller will
still wait. It is a remainder, not a timestamp, for the reason gRPC's
`grpc-timeout` is — two hosts' clocks need not agree.

- The service shell reads it per request into a `Deadline` service. Absent, the
  route's own timeout applies.
- No retry starts after the deadline has passed.
- An outbound call through `fetch-client` forwards what is left, minus the time
  already spent, and carries an `AbortSignal` tied to fiber interruption — so
  when the caller goes away, the call below it is cancelled rather than left to
  finish.
- An edge that knows the route's timeout seeds the header; a browser does not
  send one.

### Bus redelivery is sized against the same budget

A queue's `x-delivery-limit` stays a per-subscription dial — it is immutable
once the queue exists, and changing it is a queue reset. The host sizes it so
that in-process attempts × deliveries stays inside one fleet delivery budget,
and because a consumer never retries in-process that product is the delivery
limit itself. Classification is [ADR 0013](0013-failures-are-typed-values-decided-at-the-shell.md)'s:
business and `protocol` failures are poison and quarantined at once, the
transient categories are redelivered.

## Consequences

- A participant has to be idempotent for a coordinator to retry it, and the
  mount-time check makes that a boot failure rather than a duplicate charge.
- The browser shows a failed read immediately instead of after three silent
  retries. That is the intended trade: the service already retried, and a
  fourth layer only delays the honest answer.
- A dependency that is down sees at most 10% more traffic than its callers'
  first attempts, plus the floor — and under adaptive throttling, less than its
  first attempts. A recovering dependency is not stampeded.
- Every dial is per host configuration. A host that sets them to zero has no
  retries, which is a legitimate choice and the safe default for a write path
  with no idempotency key.
- The coordinator's `POST_PIVOT_RETRIES` loop is not rewritten here; it is
  replaced by the workflow engine. Until then it is the one retry that does not
  draw from the budget.
