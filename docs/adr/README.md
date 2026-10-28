# Architecture Decision Records

Short records of significant architectural decisions — the context, the decision,
and its consequences. One file per decision, numbered.

**An ADR's reasoning is immutable; its factual claims are not.** A statement
about how the framework is arranged is corrected in place when it stops being
true. A _decision_ that no longer holds is still superseded by a new record,
never edited away.

Format: [Michael Nygard's ADR template](https://github.com/joelparkerhenderson/architecture-decision-record).

## This collection starts at 0001, and the older records are elsewhere

entifix was extracted from `r10c-technologies/r10c`, which holds 59 records of
its own. They stayed there: they are one connected body, supersessions run
across them, and the reasoning behind a shell is inseparable from the
application it was drawn for.

entifix source does not cite them. Every `ADR NNNN` in this repository names a
record here — `@entifix/docs-check` fails on one that does not, and on any
reference to that repository from source — so a number in a comment never needs
a second collection to make sense. ⚠️ The two collections share the numbers
0001–0007, which is the reason the check reads the number rather than trusting
it ([ADR 0001](0001-the-tier-contract-and-the-host-seam.md) has the history).

## Status lifecycle

**Proposed → Accepted → Superseded.**

- **Accepted** — in effect. The code follows it; a change that contradicts it
  needs a superseding record, not a pull-request comment.
- **Proposed** — decided in full but not yet implemented. A Proposed record
  carries a `## Trigger` section naming what promotes it, so the iteration that
  finally needs the decision inherits the reasoning instead of re-deriving it.
- **Superseded** — replaced. Kept, never deleted, with a link forward.

## Every record carries two headers, and the build checks them

```
- Area: entities | adapters | ui | platform | testing
- Read when: <the symptom that should send a reader here>
```

`- Read when:` names the **symptom**, not the subject. A line naming the subject
gets skipped; one naming the symptom gets read, and that is the whole difference
between an index and a digest. `pnpm nx test @entifix/docs-check` fails on a
record missing either header, or filed under an area that is not in the list.

## Correcting a record

Three tiers. The first two edit in place; only the third uses a new record.

- **Fix** — the record asserts something about the code that is now false.
  Correct it where it stands.
- **Clarify** — the reasoning holds and the wording now misleads. Rewrite in
  place, usually as a dated blockquote beside the original so the change is
  visible rather than silent.
- **Supersede** — the _decision_ no longer holds. A new record, with a
  blockquote in the old one pointing forward and its text kept.

An **Accepted** record gains a header line when it is edited in place —

```
- Revised: <date> by [ADR 00XX](00XX-….md) — <what changed, in one clause>
```

— so `grep -n "Revised:" docs/adr/0*.md` lists every in-place edit ever made.

**Supersession is symmetric**, and it is the rule most easily missed: a record
claiming to supersede another must leave the reciprocal line _on the record it
overrode_. Writing it only forward means a reader who opens the old record sees
`Status: Accepted` and no marker. `@entifix/docs-check` fails the build on a
one-way claim.

## The records

- [0001](0001-the-tier-contract-and-the-host-seam.md) — **The tier contract, and the seam a host configures across.** Read when adding a package, adding a dependency between two, deciding whether something is public API, or about to bake a host's value into framework code.
- [0002](0002-entifix-is-mit.md) — **entifix is MIT, and the trigger that would freeze that choice.** Read when publishing a package, accepting an outside contribution, or wondering whether the licence can still be changed.
- [0003](0003-releasing-without-a-credential.md) — **Releasing without a credential, and the version a commit is allowed to cut.** Read when cutting a release, wondering why the release workflow cannot be renamed, or why a merge did not publish anything.
- [0004](0004-the-examples-are-the-composability-proof.md) — **The examples are the composability proof, and one of them gates every pull request.** Read when adding an example or an e2e journey, putting an entity class inside a Next application, or a `@useCase()` verb never appears on screen.
- [0005](0005-content-an-entity-describes.md) — **Content an entity describes.** Read when declaring locales, holding text in several languages, writing a validation rule a consumer keeps repeating, publishing an entity narrower than it is stored, serving records that arrive as JSON, or about to write a second in-memory filter.
- [0006](0006-the-public-contract-is-entities-use-cases-and-ports.md) — **A package's public contract is entities, use cases and ports.** Read when adding an export to a `.` entry, adding an option that takes an adapter's product, or a consumer cannot ban a mechanism because it shares an entry point with a contract.
- [0007](0007-the-host-supplies-the-role-ladder.md) — **The host supplies the role ladder; the screen taxonomy is entifix's.** Read when adding a role, changing who may assign whom, building a second host on `@entifix/authz`, or about to add a fifth screen type.
- [0008](0008-an-entity-can-declare-a-hierarchy.md) — **An entity can declare a hierarchy.** Read when an entity's records nest under one another, building breadcrumbs or a tree from records, or about to write a recursive query.
- [0009](0009-a-unit-of-work-the-outbox-inbox-and-command-claim-join.md) — **A unit of work the outbox, inbox and command claim join.** Read when a write has to announce itself on the bus, a consumer has to fold a message exactly once, or a participant has to answer a redelivered command — and you are about to open a driver session by hand.
- [0010](0010-entity-routes-are-derived-and-the-repository-comes-from-context.md) — **Entity routes are derived, and the repository comes from context.** Read when writing a list, read, create, update or delete route for an entity, a route's links name a verb that answers `404`, or a route builds its own repository.
- [0011](0011-like-ignores-accents.md) — **`like` ignores accents.** Read when a search for `cafe` does not find `Café`, writing a filter translator for a new engine, or about to add a collation, a text index or a second "search" operator.
- [0012](0012-facet-counts-are-a-port-of-their-own.md) — **Facet counts are a port of their own.** Read when a listing has to show how many records each filter choice would keep, adding a count or an aggregation to a store, or about to put counts on `EntityPage` or a method on `EntityRepository`.
- [0013](0013-failures-are-typed-values-decided-at-the-shell.md) — **Failures are typed values with a family and a category, and the shell decides what they mean.** Read when adding a refusal or an error type, mapping a failure to an HTTP status, writing an error body by hand, catching an adapter's error with `instanceof`, deciding whether a bus message is poison, or about to call `Effect.log*` from a package that is not a shell.
- [0014](0014-retry-once-at-the-layer-above-under-a-budget.md) — **Retry once, at the layer directly above the failure, under a budget and a deadline.** Read when adding a retry, a backoff or a `Schedule` to a call, sizing a queue's `maxAttempts`, an outage gets worse when its dependency comes back, a request keeps working after its caller gave up, or about to retry inside a bus consumer.
- [0015](0015-composed-flows-and-use-case-resolution.md) — **Composed flows and use-case resolution: fragments, a pinned routing slip, ordered predicates over a verified context.** Read when adding a step to a multi-step flow, letting a module contribute to a flow it does not own, choosing an implementation from who is calling, narrowing a read to its caller, or about to write a `SagaDefinition` or a `scope` callback.
- [0016](0016-a-flow-engine-port-and-a-durable-workflow-adapter.md) — **A flow engine port, and a durable workflow adapter that interprets the pinned slip.** Read when running a multi-step flow, deciding where a flow survives its process dying, adding a wait, a child flow or a join to a flow, bumping the `effect` pin, or about to import `effect/workflow` or `effect/cluster`.
- [0017](0017-circuit-breaker-and-bulkhead-ports.md) — **Circuit breaker and bulkhead ports, with per-process engines.** Read when a failing dependency drags down its callers, a consumer quarantines messages during an outage, sizing how many concurrent calls a participant may take, or about to write a breaker or a semaphore by hand.
- [0018](0018-one-outbox-ordered-per-aggregate.md) — **One outbox for every domain event, ordered per aggregate.** Read when emitting a domain event from a write, consuming an event that may arrive out of order, an event stuck at the head of the outbox delays unrelated ones, writing an outbox on a new engine, or about to reach for change data capture.
