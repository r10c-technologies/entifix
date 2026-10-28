# 13. Failures are typed values with a family and a category, and the shell decides what they mean

- Status: Accepted
- Date: 2026-10-28
- Area: platform
- Read when: adding a refusal or an error type, mapping a failure to an HTTP status, writing an error body by hand, catching an adapter's error with `instanceof`, deciding whether a bus message is poison, or about to call `Effect.log*` from a package that is not a shell

## Context

Everything that went wrong in entifix was one class tree, `EntifixError` and its
five subclasses (`packages/ts/core/src/base-entities/entifix-error/entifix-error.ts`).
The class said which package was unhappy, not what happened, and every consumer
had to guess the rest:

- **The HTTP answer was a guess.** `service-shell` answered errors in four
  shapes — `{ error }`, `{ message }` on a `404`, `EntityRouteRefusal`, and
  `routeFailure`, whose body was `detail: String(error)`. A defect's message,
  and sometimes its `[object Object]`, reached the browser.
- **A refusal and an outage looked the same.** `fetch-client` turned every
  non-2xx into `EntifixConnError`, so a business `409` — "that slug is taken" —
  arrived in the browser as a connection failure and was shown as one.
- **The bus decided poison by class.** `error instanceof EntifixBuildError ?
  'poison' : 'transient'` retried a business refusal and a protocol mismatch to
  `x-delivery-limit`, and an `instanceof` across two copies of the module
  answers `false` for an error that is plainly the class.
- **Datastore errors carried no meaning.** A duplicate key, a lost connection
  and a timeout were all `EntifixConnError`, so nothing above the adapter could
  tell a conflict it should report from an outage it should wait out.
- **Mechanisms logged from inside.** The outbox relay and the shutdown registry
  called `Effect.log*` themselves. The host could not choose the level or the
  sink, and the same failure was logged twice when the fork site logged too.

Effect already holds the parts of an answer. A failure in the `E` channel is a
value the compiler tracks, `Schema.TaggedError` gives it a tag and a schema, and
a schema can be encoded onto a wire and decoded back. What was missing was a
vocabulary for **what a failure means** that every layer shares.

## Decision

### A failure is a value with a family and a category

Every failure the framework raises, and every failure a host defines, is an
`EntifixFailure`: a `Schema.TaggedError` carrying four facts.

- `_tag` — what happened, open-ended (`DuplicateSlug`, `CardDeclined`).
- `code` — the permanent, wire-visible key a client translates. Codes follow
  Google's AIP-193 rule: once shipped, a code never changes meaning and is never
  reused.
- `category` — one of a **closed** set, below.
- `family` — derived from the category, never declared.

There are two families, and the difference is the whole point of having them:

- **business** — _an answer_. The request was understood and the answer is no.
  Never retried, never trips a breaker, logged at debug.
- **technical** — _a non-answer_. Something stopped the request being answered.
  May be retried by the layer directly above it ([ADR 0014](0014-retry-once-at-the-layer-above-under-a-budget.md)).

| Family    | Category          | Default status | Meaning                                                 |
| --------- | ----------------- | -------------- | ------------------------------------------------------- |
| business  | `invalid`         | 400            | the request is malformed or breaks a rule on its own    |
| business  | `unauthenticated` | 401            | no credential, or one that does not verify              |
| business  | `forbidden`       | 403            | a verified caller without the grant                     |
| business  | `notFound`        | 404            | the addressed record does not exist                     |
| business  | `conflict`        | 409            | the request contradicts the stored state                |
| business  | `declined`        | 422            | a rule over other records, or a third party, said no    |
| technical | `contention`      | 409            | lost a race that a retry can win                        |
| technical | `exhausted`       | 429            | a limit or a budget is spent                            |
| technical | `unavailable`     | 503            | a dependency could not be reached                       |
| technical | `timeout`         | 504            | a dependency did not answer in time                     |
| technical | `protocol`        | 502            | a peer answered something that does not decode          |
| technical | `internal`        | 500            | a bug, surfaced as a value                              |

The categories are closed because every layer branches on them — the shell's
status and log tables, the bus's poison rule, the client's inline-versus-toast
choice — and a twelve-row table is one every one of those can be exhaustive
over. Tags stay open because a domain names its own refusals. The statuses are
gRPC's canonical mapping as Google publishes it, which is where `contention`
answering `409` beside `conflict` comes from: the code is what tells them apart.

### Failures are defined through one helper and registered at load

```ts
class DuplicateSlug extends Failure.conflict<DuplicateSlug>()(
  'DuplicateSlug',
  'duplicateSlug',
  { slug: Schema.String },
) {}
```

`Failure.<category>` builds the `Schema.TaggedError` and records
`{ code, tag, family, category, type }` in a module-level registry the moment
the class is defined. **A second class with the same code throws at module
load**, so a collision is a boot failure and never two meanings on one wire. The
registry is what the problem decoder reads, and what a host's catalog gate reads
to prove every code has a sentence.

Private sentinels a mechanism uses to steer its own control flow — a claim
already taken, a sweep with nothing to do — stay `Data.TaggedClass` with no
code. They never cross a package boundary and never reach a wire, so they never
enter the registry.

### Match on the tag or the category, never on the class

`Failure.isTag`, `Failure.isCategory`, `Failure.isFamily` and `Failure.when` are
refinements composed with `and`, `or` and `not`, so `E` narrows where they are
used. They read the `_tag` and the registered category, never the prototype, so
a failure decoded from a wire — or defined in a second copy of the module —
matches exactly as one constructed in place. `instanceof` on a failure is a
defect in waiting.

### The wire is RFC 9457, with the code at the top level

Every error answer is `application/problem+json`:

```json
{
  "type": "urn:entifix:failure:duplicateSlug",
  "title": "DuplicateSlug",
  "status": 409,
  "code": "duplicateSlug",
  "category": "conflict",
  "detail": "…",
  "instance": "/api/brand/…",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "slug": "aurora"
}
```

`problemOf(failure, { status, traceId, instance })` encodes; `decodeProblem`
returns the registered failure with its typed fields, or a `ProtocolFailure`
carrying the status when the body is not a problem or names an unknown code. A
defect is never encoded: it answers an opaque `500` problem with the `traceId`
and nothing else, and is logged in full where it was caught. `detail` is never
`String(error)`.

### Reactions are composed at the shell; `respond` is terminal

A failure travels in `E` unchanged until it reaches the composition root. There
the host composes reactions as plain transforms — `On(predicate).retry`,
`.delay`, `.fallback`, `.recover` — and ends the chain with `respond(effect,
policy)`, which admits only `E extends EntifixFailure`. The policy is the
category's default status with a per-tag override, the problem body, and the
log level. `mountRoutes(routes, policy)` applies it once to a whole route set,
so a handler whose `E` is not an `EntifixFailure` does not compile at the mount.
A router-level net on `catchDefect` — never `catchCause`, which would swallow
interruption — answers whatever escapes. No rule DSL: a reaction is an Effect
function, and the compiler already checks those.

### Mechanisms emit outcomes; the fork site logs

Nothing in tiers 1–3 logs. A relay sweep returns `drained`, `quarantined` or
`sweepFailed`; a shutdown hook reports `hookTimedOut`, `draining`, `drained`.
The daemon's **fork site** — the shell that started it — decides the level and
the sink. The only logging allowed below a shell is `service-shell`'s own
`observability.ts` and `respond.ts`, which are the policy. ESLint's
`no-restricted-syntax` bans `Effect.log*`, `Effect.annotateLogs`,
`Effect.withLogSpan` and `console.*` across `packages/ts/**` and
`packages/react/**`, and `tools/conventions` lints a planted violation with the
real configuration so the rule cannot quietly stop matching.

The default log table: business at `debug`; `unavailable`, `timeout`,
`contention` and `exhausted` at `warning`; `protocol`, `internal` and defects at
`error`. Every record carries `code`, `category`, `tag` and `traceId`.

### Transports carry the failure, not a guess about it

- **The Next proxy** passes a problem body through untouched, with its content
  type, `Retry-After`, `Location` and `traceparent`, and forwards
  `Idempotency-Key`, `traceparent` and the deadline header upstream. An
  unreachable upstream is `UpstreamUnavailable`, encoded as a problem.
- **The fetch client** decodes a problem body into the failure that was sent. A
  non-problem error body is `Protocol` with the status; a network failure is
  `Unavailable`; an abort is an interruption.
- **The bus** decides by category. Every business category and `protocol` are
  poison — quarantined at once, with `x-failure-code` and `x-failure-category`
  headers — because redelivering an answer produces the same answer.
  `unavailable`, `timeout`, `contention`, `exhausted` and an uncategorised
  defect are transient, bounded by `x-delivery-limit`.

### Idempotency refusals are fleet-generic

Three failures every idempotent route shares: `IdempotencyKeyMissing` (400,
`invalid`), `IdempotencyKeyReused` with a different payload (422, `declined`)
and `IdempotencyKeyInFlight` (409, `contention`).

### Where things live

`EntifixFailure`, `Failure`, the registry, the predicates, the problem codec and
the fleet-generic failures (`Invalid`, `NotFound`, `InvalidQuery`,
`Unauthenticated`, `Forbidden`, `UpstreamUnavailable`, `Overloaded`,
`Internal`, `ProtocolFailure`, the three idempotency refusals) are in
`@entifix/core` — tier 1, so every tier can name them. `respond`, `mountRoutes`
and the policy are in `@entifix/service-shell`. `On` and the retry budget are in
[ADR 0014](0014-retry-once-at-the-layer-above-under-a-budget.md).
`failureContract(FailureClass)` in `@entifix/testing-unit` is the suite every
failure runs: it round-trips through the problem codec, is registered, has a
category, and leaks no stack.

### What this removes

Released additively first. 0.10.0 ships the new model beside the old; the
deletion release removes **`EntifixError`** and every subclass
(`EntifixBuildError`, `EntifixLogicError`, `EntifixConnError`,
`EntifixTransactionError`, `EntifixLockError`), **`EntityRouteRefusal`**,
**`routeFailure`** and **`invalid`** from `service-shell`. Adapters change what
they raise in 0.10.0 itself — that is the breaking part of the release.

The deletion release also turns on the second ban: `no-restricted-syntax` on an
error body written by hand (`HttpServerResponse.json({ error … })`) and on
`instanceof` against a failure, with a planted violation in `tools/conventions`
beside the logging one. It waits for the deletion because until then
`route-responses.ts` is still the legitimate home of the old shapes.

## Consequences

- A consumer that caught an adapter's `EntifixConnError` by class compiles
  against 0.10.0 and **stops matching**: the adapter now raises `Unavailable`,
  `Timeout` or `Conflict`. That is a behaviour change with no compile error, and
  adopting the release means finding every such check, not only the ones the
  compiler reports.
- Every code is a permanent public identifier. Renaming one is adding a new
  failure and retiring the old; the registry makes a reused code a boot failure
  rather than a silent second meaning.
- Two equal statuses (`409` for `conflict` and for `contention`) are
  distinguished by `code` and `category`, never by status. A client that
  branches on status alone gets it wrong, by design.
- A host's routes that still write `{ error, code }` bodies decode in the
  browser as `Protocol` until they move to `respond`. Accepted for the length of
  a migration rather than shipping a second decoder.
- A mechanism that has something to say must say it as a return value. That
  makes some signatures longer, and makes every one of those outcomes testable
  without capturing logs.
