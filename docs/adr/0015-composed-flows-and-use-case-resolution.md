# 15. Composed flows and use-case resolution: fragments, a pinned routing slip, ordered predicates over a verified context

- Status: Accepted
- Date: 2026-10-28
- Revised: 2026-10-29 — a caller lacking only a step's requirement is `FlowRequirementsUnmet`, and the enumerator reports it `unmet`
- Area: entities
- Read when: adding a step to a multi-step flow, letting a module contribute to a flow it does not own, choosing an implementation from who is calling, narrowing a read to its caller, or about to write a `SagaDefinition` or a `scope` callback

## Context

entifix's only multi-step mechanism is one hand-written `SagaDefinition` per
flow, checked by `defineSaga`
(`packages/ts/transactions/src/contracts/saga-definition.ts:190`) and wired
together with string templates resolved at dispatch time
(`packages/ts/transactions/src/engine/resolve-template.ts`). That shape has run
out in four places:

- **A flow cannot be assembled from parts.** A host writes each flow whole, in
  the one place allowed to name every participant. A module that owns a step —
  stock's reservation, payment's capture — cannot declare it. A change to a
  participant's contract is visible only when the flow fails live.
- **Inputs are addressed by string.** `{outcome.data.id}` and `fanOutFrom`
  name an earlier step's output by path. Nothing checks at load time that the
  path exists or that its type is the one the next step reads.
- **Nothing selects a variant from the caller.** Card and cash-on-delivery
  checkouts, a storefront and a till sale, an entitled organization and an
  unentitled one each want a different flow from the same use case. Today the
  host writes one definition per combination, or branches inside a handler.
- **Read narrowing is a callback.** `makeEntityRoutes` takes a hand `scope`
  function (`packages/effect/service-shell/src/entity-routes.ts:77`). Its by-id
  read keeps a second, in-memory `includes` predicate that can drift from the
  list filter, and every caller casts the principal to reach the fields it
  needs.

`defineSaga` also throws `EntifixLogicError` on the first problem it finds,
instead of returning every violation a CI job could report.

## Decision

### Vocabulary

Two words that have been used loosely now mean one thing each:

- An **endpoint router** maps a path to a handler. It is
  [ADR 0010](0010-entity-routes-are-derived-and-the-repository-comes-from-context.md)'s
  concern and does not change here.
- A **use-case resolver** maps a handler to an implementation, chosen from
  what is known about the caller. This record is about the resolver.

### Three layers, outermost first

| Layer       | Question it answers                                  | Mechanism                                                                        |
| ----------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| **COMPOSE** | Which steps does this flow take, for this caller?    | a recipe of fragments, composed into a **routing slip** pinned per flow instance |
| **RESOLVE** | Which implementation of this use case runs?          | ordered predicates over a **verified context**; first match wins                 |
| **BIND**    | How does that implementation reach its dependencies? | `Effect.provideService` per request, over a `Layer` graph built once at boot     |

A vendor-authored rule engine was considered and discarded: it moves business
decisions into data nobody reviews. Authoring slips through an agent or an MCP
tool is noted as a possible future front end to COMPOSE; nothing is built for
it.

### Where each piece lives

| Subpath                      | Holds                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@entifix/core`              | the context-generic predicate algebra (`and`, `or`, `not`, equality and membership over a typed record)                    |
| `@entifix/business` `.`      | `When(p).use(v)`, `Otherwise.use(v)`, `resolve`, `dryRun`, the `VerifiedContext` type, `defineVariants`, `provideResolved` |
| `@entifix/business/flow`     | the fragment descriptor, the `Slip` Schema, the pure validator, the fragment catalog and its document                      |
| `@entifix/business/compose`  | the recipe, the composer and the combination enumerator                                                                    |
| `@entifix/business/verified` | the only constructor of a `VerifiedContext`                                                                                |
| `@entifix/service-shell`     | builds the verified context from the verified principal, and serves `$metadata.composition`                                |
| `@entifix/testing-unit`      | `forEachVariant`, `variantsWithoutContract`                                                                                |

### The fragment

A fragment is one step a module contributes, declared beside the use case it
calls. It carries `id@version`, the owning `module`, its `kind`
(`compensatable`, `pivot`, `retriable` or `wait`), the `participant` and the
`call` (plus a `compensation` on a compensatable step, unless it is
`readOnly`), a `contract { input, output, failure }` of Schemas, the context
facts it `requires`, the keys it `consumes` and `provides`, whether it is
`irreversible`, the segments it is `excludedFrom`, the `isolation` countermeasure it relies on (`commutative`,
`semanticLock`, `reRead`, …), and its `cardinality`: `one`, `perVendor` or
`perLine`.

A built-in `flow.commit@1` is a pivot with no participant and no call. It marks
the commit point of a flow that has no real pivot.

### The slip grammar

A **routing slip** is ordered stages of pinned `id@n` steps. Each step names
its participant, its call, its cardinality and its pinned parameters. A step's
inputs are addressed by `provides` keys, not by string paths: this replaces
`resolve-template.ts` and `fanOutFrom`. `slipVersion` versions the grammar
itself, so an interpreter can branch on it when the grammar changes under an
in-flight instance.

The slip is **pinned per instance**: it is composed once, at start, and stored
as the flow's payload. Changing a recipe or a fragment never changes a flow
that has already started.

### Validator rules

`validateSlip(slip, catalog, ctx?)` is pure and returns every violation, one
tag per rule:

| Rule                                                                                                                                            | Violation                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| at most one pivot                                                                                                                               | `TooManyPivots`                               |
| every checkout slip, and every slip with a retriable step, has exactly one commit point (a pivot or `flow.commit@1`) before its first retriable | `MissingCommitPoint`, `RetriableBeforeCommit` |
| compensatable steps sit before the commit point                                                                                                 | `CompensatableAfterCommit`                    |
| `irreversible` steps sit at or after it                                                                                                         | `IrreversibleBeforeCommit`                    |
| `wait` steps sit at or after it                                                                                                                 | `WaitBeforeCommit`                            |
| a step does not run in a segment its fragment excludes — a card capture declares `excludedFrom: { paymentMethod: ['cashOnDelivery'] }`          | `ExcludedFromSegment`                         |
| every consumed key is provided earlier, with the same Schema                                                                                    | `UnsatisfiedInput`                            |
| every `requires` is satisfied by the context                                                                                                    | `UnmetRequirement`                            |
| every pinned `id@n` exists in the catalog                                                                                                       | `UnknownFragment`                             |

`assertValidSlip` lifts a non-empty result into a registered failure. When
every violation is an `UnmetRequirement` the recipe is sound and the caller
may not run it, so it is `FlowRequirementsUnmet` (`flowRequirementsUnmet`,
`forbidden`); anything else is `CompositionRefused` (`flowNotComposable`,
`declined`), carrying every violation. `enumerateCompositions` draws the same
line: a combination is `composed`, `unresolvable`, `unmet` or `refused`, and
only `refused` is a defect — but a host asserts which combinations are
`unmet`, because a caller wrongly left without an entitlement looks exactly
like one rightly refused.

### Constraints

- **Resolve from verified facts only.** `VerifiedContext` is a branded type —
  organization, party, `partyRole`, entitlements, roles, channel, segment, flags
  and config dials — and its constructor is exported only from
  `/verified`. An object literal typed as one does not compile. A predicate
  never reads request input.
- **Entitlement gates eligibility.** A variant's `requires` is checked before
  its predicate; an unentitled variant is skipped, never chosen and then
  refused.
- **Nothing below the shell composes.** Tier-2 and tier-5 packages may not
  import `/compose` or `/verified`; an interpreter receives a pinned slip and
  never sees a recipe.
- **A contract per use case, a suite per variant.** Every variant of a use case
  runs that use case's contract suite through `forEachVariant`;
  `variantsWithoutContract` lists one that does not.
- **Every resolution is observable.** Spans carry `entifix.use_case`,
  `entifix.variant`, `entifix.slip.version` and `entifix.slip.fragments`.

### Queries

A query variant is a **narrowing**, conjoined onto the load request's filtering:
`unscoped`, `nothing`, or a filter group. The by-id read is a load with the
narrowing plus id equality, so a list and a read can never disagree about what
the caller may see, and `nothing` answers an empty page without a query.

## Consequences

- A module declares the steps it owns, versioned and typed, and a contract
  change without a version bump is visible to a catalog snapshot before it is
  visible to a running flow.
- Card, cash-on-delivery and multi-vendor flows are compositions of the same
  fragments, and CI can enumerate every combination a recipe can produce.
- `$metadata` can say which variant and which recipe a verb resolves to for
  the caller asking.
- **What becomes deletable, and by which issue:**
  `contracts/saga-definition.ts` and `engine/resolve-template.ts` go with the
  saga runner in [#127](https://github.com/r10c-technologies/entifix/issues/127);
  the `scope` option and `EntityReadScope.includes` go in
  [#126](https://github.com/r10c-technologies/entifix/issues/126). Both stay
  exported until then, so a host migrates one slice at a time.
- **Checks that enforce it:** the validator's specs (one per rule); the
  `@ts-expect-error` on a literal `VerifiedContext`; the
  `no-restricted-imports` rule on `/compose` and `/verified` with its planted
  violation in `tools/conventions`; `forEachVariant` and
  `variantsWithoutContract`.
- The composer and the resolver are in-process. A remote variant is a fragment
  step, interpreted by the flow engine port specified in
  [#100](https://github.com/r10c-technologies/entifix/issues/100).
