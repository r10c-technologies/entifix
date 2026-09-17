# 4. The examples are the composability proof, and one of them gates every pull request

- Status: Accepted
- Date: 2026-09-16
- Revised: 2026-09-16 by [#2](https://github.com/r10c-technologies/entifix/issues/2) — all three examples built; the engines swapped, compose chosen, mock profiles joined the pull request check
- Area: testing
- Read when: adding an example, adding an e2e journey, putting an entity class inside a Next application, or wondering why a verb declared with `@useCase()` never appears on screen — entity classes need SWC's 2022-03 decorators, which Next's own compiler cannot provide

## Context

entifix shipped with 187 spec files and no end-to-end test. Every journey that
had ever exercised it lived in r10c's `apps/*-e2e`, and those were the only
consumers of `@entifix/testing-e2e`. The tier contract
([ADR 0001](0001-the-tier-contract-and-the-host-seam.md)) claims a tier can be
adopted without the ones above it, and nothing in this repository showed that
claim holding in a running application.

Issue #2 asked for three examples, each a different cut through the tiers:

| Example             | Tiers                            | Proves                                      |
| ------------------- | -------------------------------- | ------------------------------------------- |
| `example-workspace` | T0 + T1 + T3, and the Next shell | the UI stands alone: no adapter, no backend |
| `example-service`   | T0 + T1 + T2 + service-shell     | the backend stands alone: no React          |
| `example-minimal`   | all                              | the full stack composes                     |

All three are built.

## Decision

### The hermetic example is a required check; the rest run nightly

`example-workspace` needs nothing outside the page. Its repositories are
`@entifix/testing-unit`'s in-memory double, its metadata document is answered
locally, and its one server call — record search — is its own route. So its
Playwright suite runs in `pull_request_check.yml` as the `e2e` job, which is in
`Done`'s `needs`: a change that breaks the UI tier fails the pull request that
made it.

An example that needs a database runs **live** on a schedule instead —
`examples_nightly.yml`, daily and on demand. A required check that depends on a
container starting is a check that fails for reasons nobody changed.

> **2026-09-16.** That turned out to be a split within an example rather than
> between examples. `example-service`'s journeys run under two profiles: `mock`
> boots its real routes and domain layer over the Mongo and AMQP drivers' fakes
> and joins the required `e2e` job, and `live` runs the same journeys nightly.
> `example-minimal` has no fake for Postgres to run over, so its only target is
> `e2e-live` — a name the pull request check does not collect, from a config
> file the Playwright plugin infers no `e2e` target from.

### The engines are swapped from what #2 asked for

The issue put `example-service` on Postgres, with an outbox, a bus and a saga,
and `example-minimal` on Mongo. Measured against what the packages ship, that
was backwards: `@entifix/sql` has a repository and a readiness probe and
nothing else — no outbox, inbox or saga store — while `@entifix/mongo/transactions`
had the outbox, its relay and the inbox. So `example-service` is Mongo +
RabbitMQ and `example-minimal` is Postgres, where one flat entity's CRUD is
exactly what the SQL adapter does. Postgres is still proven end to end; it is
proven where it is sufficient.

Building the saga half surfaced that **no engine** had a saga store and the only
dispatcher anyone had written was HTTP. Both went into the framework rather than
the example — `makeMongoSagaStore`, `makeLocalSagaDispatcher` and
`startSagaResume` (#27) — because an example that must write its own adapters
demonstrates what an adopter is missing, not what entifix gives them.

### No port of r10c's health ladder

r10c walks a twelve-rung ladder because it runs a twelve-service fleet on
minikube. Two examples need three containers, and they are one
`examples/compose.yaml`: a single-node Mongo replica set (transactions need one;
the healthcheck initiates it and waits for a writable primary), RabbitMQ and
Postgres. Compose rather than testcontainers because the same file serves a
developer's machine and the nightly job, and a live profile points at a service
that is already running rather than one each suite starts.

### No coverage gate on `examples/*`

The 100% gate covers `packages/*`. A gate on demo code is what makes demos
elaborate, and an example's job is to be copied.

### An example may import a `type:testing` package, and says so where it does

`example-workspace` runs on `makeInMemoryEntityRepository`, which is a test
double. Using it is the point — it mirrors the Mongo adapter's filtering, sorting
and paging, which is exactly what a UI needs to be exercised without a backend —
and the module that imports it says, in its first paragraph, that a real
application passes a REST adapter's `Context` under the same keys. That double
had to become browser-safe first: it imported `randomUUID` from `node:crypto`,
which a browser bundle cannot resolve.

### Entity classes live in a compiled package, never in the Next application

Measured on Next 16.2.10. An entity written in the application's own `src`:

- **Turbopack** panics in its decorator transform —
  `not implemented: ClassMember::PrivateProp` — on the `#field` every entity
  declares, and reports it as `Module not found` for every importer.
- **webpack** (`next build --webpack`) does not parse the decorator at all:
  `Expression expected` at `@entity(`.

Neither compiler offers the `decoratorVersion: '2022-03'` transform the packages
are built with. So the example's entities are `@entifix/example-workspace-domain`,
built by `@nx/js:swc` with the same `.swcrc` as every package, and the
application imports its `dist`. This is how r10c was arranged all along, which is
why it never met the failure.

⚠️ **That package is `sideEffects: true`, and it has to be.** A `@useCase()`
class is never named by the code that renders its verb — the verb is read off the
entity's metadata — so a bundler treats the class as dead and drops it, and with
it the decorator that registered the verb. Every verb then disappears without an
error: the metadata document answers `useCases: []`. Registration by decorator is
a side effect, and the manifest must say so.

## Consequences

- A pull request touching any package the workspace example composes runs its
  journeys; one touching nothing it composes skips them, like every other matrix.
- The example's `build` target is Next's, which rejects the CI build step's
  `--skipTypeCheck=false`. Its target sets `forwardAllArgs: false`. `next build`
  type-checks on its own.
- **An example's `playwright.config.ts` imports nothing from this workspace.**
  Nx loads every Playwright config in plain Node to build its project graph,
  before anything is built, so `defineEntifixE2eConfig` resolves to a `dist` a
  clean checkout does not have and the graph fails for every command. The
  example writes its config on `@playwright/test` and `nxE2EPreset` directly; the
  specs, loaded later with the `@entifix/source` condition, import
  `@entifix/testing-e2e` freely. An adopter installing from npm has the `dist` and
  can use the preset.
- That graph failure also showed the pull request check computing **empty**
  project lists rather than failing — a `bash -e` step without `pipefail`, and a
  substitution inside an `echo` — so every matrix was `skipped` and `Done` was
  one green assertion job away from passing a run in which nothing ran. The
  lists are now assigned under `pipefail` first.
- Two framework behaviours surfaced that a server-backed host never sees, and
  the example first worked around and later fixed:
  - A generated list's "open" control was a plain link, so following it was a
    document load — and inside a workspace tab it left the workspace. Fixed in
    [#20](https://github.com/r10c-technologies/entifix/issues/20): the table
    and form take a `renderLink`, the Next shell passes one on `next/link`, and
    a tab host answers Open, New and Back by opening a tab of its own kind. A
    journey plants a marker on `window` to prove nothing reloads.
  - `@entifix/testing-unit`'s repository handed back the instance it stored. A
    verb that mutated that instance changed the record under the query cache
    without the cache seeing a new value. Fixed in
    [#21](https://github.com/r10c-technologies/entifix/issues/21): the double
    now hands out copies, as a real adapter does, and the contract suite holds
    every repository to it.
- The README's i18n snippet declared `defaultNS: 'app'`. The framework's own
  components call `useT()` without a namespace and render raw keys —
  `form.save`, `detail.addRow` — unless the default is `'controls'`. The example
  uses `'controls'`, and the README says so.

## What this record does not decide

Whether a verb bound to no entity belongs in the palette of an example with no
backend, or a Postgres outbox, inbox and saga store for `@entifix/sql` — which
the engine swap above avoided needing rather than decided against.
