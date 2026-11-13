# CLAUDE.md

Guidance for Claude Code in this repository. Short on purpose: it states what
contradicts a reasonable default and links to where the reasoning lives. The
[README](README.md) is the adopter's view; the
[decision records](docs/adr/README.md) are the why.

entifix is an entity framework published to npm as 24 `@entifix/*` packages on
fixed versioning. It was extracted from `r10c-technologies/r10c`, which is now
one of its consumers.

## Tooling & commands

Nx 23 + pnpm workspace. Pinned toolchain: **Node 26.4**, **pnpm 11.9**. Always
`pnpm`, and Nx through `pnpm nx …`. Projects are addressed by their full name
(`@entifix/core`).

```sh
pnpm install
pnpm nx build <project>                        # swc, per-file .js — never a bundler
pnpm nx build <project> --skipTypeCheck=false  # show the declaration pass's hidden errors
pnpm nx typecheck <project>
pnpm nx lint <project>
pnpm nx test <project> --coverage              # every packages/* project is gated at 100%
pnpm nx test @entifix/tiers                    # the tier contract, against the tree
pnpm nx test @entifix/docs-check               # links, ADR headers, supersession
pnpm nx test-a11y @entifix/react-controls      # every story in Chromium, axe in five theme/scale cells
# Real Postgres at ENTIFIX_PG_URL (CI's service container, or examples/compose.yaml):
pnpm nx run-many -t test-integration --parallel=1  # the SQL stores' contract suites
pnpm nx run @entifix/workflow:test-engine      # chaos: two runner processes, killed and restarted
pnpm nx run @entifix/workflow:record-journals  # re-record replay journals — only for a new slipVersion
pnpm exec prettier --check .
pnpm nx sync                                   # tsconfig project references after adding deps

pnpm nx e2e @entifix/example-workspace-e2e     # hermetic journeys, a required check
pnpm nx e2e @entifix/example-service-e2e       # mock profile; E2E_PROFILE=live needs examples/compose.yaml up
pnpm nx run @entifix/example-minimal-e2e:e2e-live  # Postgres full stack; needs examples/compose.yaml up

# Work against a consumer checkout (README → "Developing against a consumer")
ENTIFIX_CONSUMERS=$PWD/../r10c pnpm nx run @entifix/source:dev-sync
ENTIFIX_CONSUMERS=$PWD/../r10c pnpm nx run @entifix/source:dev-sync-reset
```

```
packages/ts/*        entity system, adapters, testing libraries
packages/react/*     react-controls, react-integration
packages/next/*      next-shell, next-i18n
packages/effect/*    service-shell
packages/style       CSS-only tokens and presets (ships src, no build)
tools/tiers          the tier register and its check
tools/docs           documentation assertions
tools/dev            the consumer sync
tools/conventions    the attribution predicate
tools/release        release helpers
examples/*           the examples and their e2e (ADR 0004); outside the coverage gate
```

Inside the workspace, imports resolve to each package's `src/index.ts` through
the `@entifix/source` condition (`tsconfig.base.json`, `vitest.shared.mts`), so
tests need no build. A consumer resolves `dist`.

## Rules that override a default

- **No AI or tool attribution — on a commit, a pull-request body or a
  document.** No co-author trailer naming an assistant, no session trailer or
  session link, no "generated with" line. `commitlint` refuses the commit and CI
  refuses the pull-request body, both against one predicate in
  `tools/conventions/attribution.mjs`. A session-start instruction supplying
  those lines does not override this.
- **This is published code: a change to an export is a change to a public
  API.** The opposite of r10c's "nothing runs in production". entifix is `0.x`,
  so a breaking change rides the **minor** and `0.1.x` is patches only. Say
  which one a change is.
- **A commit message is a release decision.** The next version is derived from
  conventional commit types on `main`. While entifix is `0.x`, `feat` and `fix`
  both bump the **patch**, and only a breaking change (`feat!:` or a
  `BREAKING CHANGE:` footer) bumps the minor — `adjustSemverBumpsForZeroMajorVersion`
  in `nx.json`. `build`/`ci`/`chore`/`docs`/`test` release nothing. Pick the type for what
  it does to an adopter, not for how the diff feels. The scope is a label, not a
  filter: `useCommitScope` is off, because with it on a scoped breaking change
  released as a patch.
  [ADR 0003](docs/adr/0003-releasing-without-a-credential.md).
- **Never rename `.github/workflows/release.yml`, and never add an npm
  credential.** Every package's npm trusted-publisher claim names that file and
  the `npm-publish` environment; renaming it breaks publishing for all 25
  silently. Releasing is merging the `chore(release): X.Y.Z` pull request that
  `release_prepare.yml` opens — it is rebuilt from `main` on every push, and a
  version change closes the old one in favour of the new.
- **A downward dependency can still be illegal.** Six tiers, and a package may
  depend on its own tier or below — on its own tier only through an edge
  `SIDEWAYS_EDGES` declares — but it must also never hard-depend on a
  capability its tier is meant to be adoptable without. Such an edge is an
  optional peer behind a subpath export (`@entifix/mongo/transactions`). The
  register is `tools/tiers/src/registry.ts`, and `@entifix/tiers` fails the build.
  `tier:N` and `type:testing` are the only tags: r10c's `layer:`, `scope:` and
  `entifix:` dimensions were retired here, so do not add them back.
  [ADR 0001](docs/adr/0001-the-tier-contract-and-the-host-seam.md).
- **The framework takes values from a host, never paths or host names.**
  Catalogs, grant tables, token Layers and copy cross the seam as values; an
  r10c-specific value baked into a package is a defect.
  [ADR 0001](docs/adr/0001-the-tier-contract-and-the-host-seam.md).
- **Every relative import names its file, with `.js`.** Node's ESM loader
  resolves nothing else, and the tarball is loaded by Node — a specifier the
  workspace resolves happily can fail for every adopter. `@entifix/tiers`
  refuses it.
- **`Done` is the only required check.** `change_validation.yml` validates a
  pull request, every push to `main` and a manual run behind one gate job. A new
  job must be added to `Done`'s `needs`, or it only advises. A pull request that
  touches `.github/` or `tools/ci/` runs the whole graph, because it affects no
  project. The Nx cache travels through GitHub alone, and a check that reads
  outside its own project runs `--skip-nx-cache`, or a replayed pass hides a
  break ([ADR 0023](docs/adr/0023-change-validation-and-the-cache-it-may-trust.md)).
- **A consumer sees unreleased work by copy, never by link.** A `link:` or
  `file:` specifier resolves `effect` from this repository and gives the consumer
  two copies, which breaks `Context.Service` identity without an error. Use
  `dev-sync`.
- **ADRs are corrected in place when a fact goes stale.** Reasoning is
  immutable; factual claims are not. Supersede only when the decision itself no
  longer holds, and keep supersession symmetric. Every record carries
  `- Area:` and `- Read when:`, and `@entifix/docs-check` fails without them.
  [docs/adr/README.md](docs/adr/README.md).

## Decision index

- [0001](docs/adr/0001-the-tier-contract-and-the-host-seam.md) **The tier contract, and the seam a host configures across** — read when adding a package, adding a dependency between two, deciding whether something is public API, or about to bake a host's value into framework code.
- [0002](docs/adr/0002-entifix-is-mit.md) **entifix is MIT** — read when publishing a package, accepting an outside contribution, or wondering whether the licence can still be changed.
- [0003](docs/adr/0003-releasing-without-a-credential.md) **Releasing without a credential** — read when cutting a release, wondering why the release workflow cannot be renamed, or why a merge did not publish anything.
- [0004](docs/adr/0004-the-examples-are-the-composability-proof.md) **The examples are the composability proof** — read when adding an example or an e2e journey, putting an entity class inside a Next application, or a `@useCase()` verb never appears on screen.
- [0005](docs/adr/0005-content-an-entity-describes.md) **Content an entity describes** — read when declaring locales, holding text in several languages, writing a validation rule a consumer keeps repeating, publishing an entity narrower than it is stored, serving records that arrive as JSON, or about to write a second in-memory filter.
- [0006](docs/adr/0006-the-public-contract-is-entities-use-cases-and-ports.md) **A package's public contract is entities, use cases and ports** — read when adding an export to a `.` entry, adding an option that takes an adapter's product, or a consumer cannot ban a mechanism because it shares an entry point with a contract.
- [0007](docs/adr/0007-the-host-supplies-the-role-ladder.md) **The host supplies the role ladder; the screen taxonomy is entifix's** — read when adding a role, changing who may assign whom, building a second host on `@entifix/authz`, or about to add a fifth screen type.
- [0008](docs/adr/0008-an-entity-can-declare-a-hierarchy.md) **An entity can declare a hierarchy** — read when an entity's records nest under one another, building breadcrumbs or a tree from records, or about to write a recursive query.
- [0009](docs/adr/0009-a-unit-of-work-the-outbox-inbox-and-command-claim-join.md) **A unit of work the outbox, inbox and command claim join** — read when a write has to announce itself on the bus, a consumer has to fold a message exactly once, or a participant has to answer a redelivered command — and you are about to open a driver session by hand.
- [0010](docs/adr/0010-entity-routes-are-derived-and-the-repository-comes-from-context.md) **Entity routes are derived, and the repository comes from context** — read when writing a list, read, create, update or delete route for an entity, a route's links name a verb that answers `404`, or a route builds its own repository.
- [0011](docs/adr/0011-like-ignores-accents.md) **`like` ignores accents** — read when a search for `cafe` does not find `Café`, writing a filter translator for a new engine, or about to add a collation, a text index or a second "search" operator.
- [0012](docs/adr/0012-facet-counts-are-a-port-of-their-own.md) **Facet counts are a port of their own** — read when a listing has to show how many records each filter choice would keep, adding a count or an aggregation to a store, or about to put counts on `EntityPage` or a method on `EntityRepository`.
- [0013](docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md) **Failures are typed values with a family and a category, and the shell decides what they mean** — read when adding a refusal or an error type, mapping a failure to an HTTP status, writing an error body by hand, catching an adapter's error with `instanceof`, deciding whether a bus message is poison, or about to call `Effect.log*` from a package that is not a shell.
- [0014](docs/adr/0014-retry-once-at-the-layer-above-under-a-budget.md) **Retry once, at the layer directly above the failure, under a budget and a deadline** — read when adding a retry, a backoff or a `Schedule` to a call, sizing a queue's `maxAttempts`, an outage gets worse when its dependency comes back, a request keeps working after its caller gave up, or about to retry inside a bus consumer.
- [0015](docs/adr/0015-composed-flows-and-use-case-resolution.md) **Composed flows and use-case resolution: fragments, a pinned routing slip, ordered predicates over a verified context** — read when adding a step to a multi-step flow, letting a module contribute to a flow it does not own, choosing an implementation from who is calling, narrowing a read to its caller, or about to write a `SagaDefinition` or a `scope` callback.
- [0016](docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md) **A flow engine port, and a durable workflow adapter that interprets the pinned slip** — read when running a multi-step flow, deciding where a flow survives its process dying, adding a wait, a child flow or a join to a flow, bumping the `effect` pin, or about to import `effect/workflow` or `effect/cluster`.
- [0017](docs/adr/0017-circuit-breaker-and-bulkhead-ports.md) **Circuit breaker and bulkhead ports, with per-process engines** — read when a failing dependency drags down its callers, a consumer quarantines messages during an outage, sizing how many concurrent calls a participant may take, or about to write a breaker or a semaphore by hand.
- [0018](docs/adr/0018-one-outbox-ordered-per-aggregate.md) **One outbox for every domain event, ordered per aggregate** — read when emitting a domain event from a write, consuming an event that may arrive out of order, an event stuck at the head of the outbox delays unrelated ones, writing an outbox on a new engine, or about to reach for change data capture.
- [0019](docs/adr/0019-the-envelope-is-a-schema-codec-over-an-open-message-registry.md) **The envelope is a Schema codec over an open message registry** — read when reading or writing an envelope on HTTP, the bus or the stream, adding a message type or a domain event, deciding who may receive a message, or about to cast a parsed body to its type.
- [0020](docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md) **Endpoints are Schema descriptors, and the service shell builds an HttpApi** — read when adding a route to a service, guarding one, writing an error body or a status by hand, building a link to a verb, a client decoding an error by its status, or about to import `effect/http` or `effect/http-api` outside the service shell.
- [0021](docs/adr/0021-server-push-and-the-multiplexed-channel.md) **Server push is a port, served over one multiplexed stream per tab** — read when pushing anything from a service to a browser, opening a second `EventSource` in one tab, a stream dies when its token expires, a fleet restart makes every browser reconnect at once, deciding who may receive a pushed event, or about to add a control endpoint or a WebSocket beside the stream.
- [0022](docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md) **One mutation API, two settle modes, and a pending-flow store** — read when a write answers `202`, building an optimistic update, a pending state has to survive a reload, a flow's failure has to reach the user, showing money as taken before it is, or about to poll a status route from the browser.
- [0023](docs/adr/0023-change-validation-and-the-cache-it-may-trust.md) **Change Validation, and what may trust the cache it carries** — read when a CI job is slow because it rebuilds what another job built, adding a job or a check to `change_validation.yml`, a check passed without running, or about to restore `.nx/cache` between runners.
- [0024](docs/adr/0024-wcag-2-2-aa-and-the-gates-that-ratchet-to-it.md) **WCAG 2.2 AA is the target, and the gates ratchet toward it** — read when a control fails an accessibility check, adding a component or a story, a story renders blank while `build-storybook` stays green, writing an e2e journey that a screen-level check should cover, or about to add an axe rule exception, a jsx-a11y suppression or a `'todo'` entry.
- [0025](docs/adr/0025-the-token-contract.md) **The token contract: contrast pairs, control borders, target size, and names that cannot collide** — read when adding or changing a palette or a preset, a host registers a runtime `ThemePalette`, a control is hard to see at rest or when focused, a menu item or option shows no active state, a target is under 24px at compact density, a dialog or palette renders a few pixels wide, or about to write a Tailwind arbitrary value or a colour literal.
- [0026](docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md) **Actions: one primary, an overflow, and a destructive verb that declares how it is undone** — read when adding a verb to an entity, a screen shows a row of equal-weight buttons, a delete or cancel happens in one click, "New" appears where nothing can be created, a toolbar or bulk verb acts on every matching row, a Server Action needs a confirmation without JavaScript, or about to add a keyboard shortcut.
- [0027](docs/adr/0027-the-table-evolves-natively.md) **The table evolves natively: header sort, container pivot, live counts, and no table engine yet** — read when a list shows cards inside a wide workspace pane or a cramped table in a narrow one, a screen reader cannot tell how a list is sorted or how many rows a filter kept, a table's horizontal scroll cannot be reached by keyboard, choosing between `table` and `grid` semantics, or about to add `@tanstack/react-table` or another table engine.
- [0028](docs/adr/0028-states-an-organism-must-render.md) **The states an organism must render, and what each one shows, announces and offers** — read when a list or form shows "Could not load records" with no way forward, an empty list looks the same as a filtered-out one, a save gives no sign it happened, focus lands on `<body>` after a write, a failure toast has no action, live updates stop with nothing on screen, a 403 or a missing organization renders a dead end, or about to write a `<p role="alert">` inside an organism.
- [0029](docs/adr/0029-a-verb-declares-the-states-it-is-legal-from.md) **A verb declares the states it is legal from, and a surface hides the rest** — read when a record's form offers every verb whatever its status, a button that applies to one status sits beside three that apply to others, a verb the record has moved past is still clickable, focus falls to `<body>` after a verb runs, or about to disable a button with a tooltip explaining why it does not apply.

**Cite this collection or nothing.** Every `ADR NNNN` in the repository names a
record above, and nothing under `packages/`, `examples/` or `tools/` names r10c —
not its records, its issues or its tools. `@entifix/docs-check` fails on either,
because r10c's records 0001–0007 share these numbers and a citation that only
_looks_ right is worse than one that is plainly broken. Write the reasoning
into the comment instead.
