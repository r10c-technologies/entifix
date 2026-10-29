# 1. The tier contract, and the seam a host configures across

- Status: Accepted
- Date: 2026-09-15
- Revised: 2026-09-16 by [#6](https://github.com/r10c-technologies/entifix/issues/6) — r10c's tag dimensions retired, and a same-tier edge must now be declared
- Revised: 2026-09-16 by [ADR 0004](0004-the-examples-are-the-composability-proof.md) — the examples are decided there
- Revised: 2026-10-20 by [ADR 0005](0005-content-an-entity-describes.md) — locales are a host value now, and `@entifix/static` is a 24th package
- Revised: 2026-10-23 by [ADR 0006](0006-the-public-contract-is-entities-use-cases-and-ports.md) — what a package's public API may ask of its caller
- Revised: 2026-10-23 — the source citations of r10c's records are rewritten and a check keeps them out; the appendix that mapped them is removed
- Revised: 2026-10-28 by [ADR 0016](0016-a-flow-engine-port-and-a-durable-workflow-adapter.md) — `workflow` joins tier 2, its Postgres storage and socket runner behind optional peers
- Revised: 2026-10-29 — `@entifix/workflow` is a 25th package, in tier 2 with its socket runner behind an optional peer
- Area: platform
- Read when: adding a package, adding a dependency between two, deciding whether something is public API, or about to bake a host's value into framework code — a downward edge can still be illegal, and the seam takes values rather than paths

## Context

entifix is 23 packages extracted from `r10c-technologies/r10c`, where it had lived
as `packages/entifix/` with exactly one consumer. Why it left is recorded there,
as r10c's ADR 0059; this record is the other half — the rules it lives under now
that the consumer is somewhere else.

The extraction worked because two properties happened to hold. The dependency
graph was already a DAG with roots that reach nothing inside it — `style` depends
on nothing at all, `core` on `effect` and `tooling` on `@opentelemetry/api`, both
as peers. And exactly **one** import crossed out of the tree: `isEmpty` from
`@r10c/utils-ts-object`, in `react/integration`. Today no `@r10c/*` import remains
anywhere under `packages/`.

Neither property survives on its own. In r10c they were held by rules that do not
exist here: the `layer:entifix` tag ordering, the `scope:shared` boundary, and
above all one `nx run-many -t typecheck,build,lint,test` that proved the framework
and its consumer in a single command. That command is gone. A change to `core` is
now checked against this repository's examples, and a consumer finds out on
upgrade.

What was baked in was never structural, it was product data. The i18n package
shipped `'r10c Admin'`. The authorization package shipped a table saying a `user`
may ring up a counter sale. `require-principal.ts` read a cookie named `r10c_at`.
And the principal behind it arrived from Zitadel-backed Layers the framework
named directly. Four places, and every one of them a second host would have had
to fork rather than configure.

⚠️ **One inherited rule is now false here.** "Nothing runs in production, so do
not design for backward compatibility" is a rule about r10c's local dev fleet. It
held while one repository consumed this framework atomically. Published to two
consumers it has no cross-repo form: a breaking change in `@entifix/core` is a
change to two codebases that cannot land in one commit. Nothing in this repository
inherits it.

## Decision

### Six tiers, each adoptable without the one above

```
T0  standalone     style · tooling
T1  entity         core · business
T2  adapters       mongo · sql · redis · amqp · rest · transactions
                   workflow · jwt · zitadel · posthog · i18n
T3  ui             react-controls · react-integration
T4  app framework  authz · service-shell · next-shell · next-i18n
T5  testing        testing-unit · testing-e2e · testing-auth
```

A package may hard-depend only on its own tier or below — and **a same-tier edge
only where the register declares it**. Someone who wants entity metadata takes T1. Someone who wants a table takes T3, and must not thereby
install i18next, a Spanish catalog, a Mongo driver and a saga engine.

Two placements are worth stating because both look wrong at a glance:

- **`i18n` is T2, not T0.** It is the i18next binding of the translator port
  `react-controls` declares — an adapter to an external library, exactly as
  `mongo` is the driver binding of a repository. Only `style` and `tooling` are
  standalone.
- **`testing-*` is T5, above everything**, because a double may impersonate
  anything. `testing-auth` in particular replaces `TokenServiceTag` and
  `PolicyDecisionTag` with a service that trusts every token, which is why it is
  `type:testing` and why the alternative — an unauthenticated branch in
  `entity-metadata-route.ts` for demos — was refused.

### Sideways is declared, one edge at a time

Tier order alone would let any package reach any other in its tier: a Mongo
adapter into the SQL one, `react-controls` and `react-integration` into each
other, one shell into another. The packages arrived from r10c carrying a second,
finer ordering — `entifix:core ‹ contract ‹ {tooling, style} ‹ transactions ‹
client ‹ react`, plus `layer:*`, `scope:*`, `shell:*` and `runtime:datastore` —
and in this repository nothing enforced any of it except that ordering, which
forbade 133 edges the tiers permit. Almost all of them were sideways.

> **2026-09-16 ([#6](https://github.com/r10c-technologies/entifix/issues/6)).**
> The tags are gone. Two orderings over one graph meant two answers to "may this
> edge exist", and the finer one was named for a layering whose other layers
> stayed in r10c. What it protected is kept as `SIDEWAYS_EDGES` in the register:
> the seven same-tier edges the framework takes — `business`→`core`, the three
> datastore adapters and `rest` →`transactions`, both service and Next shells
> →`authz`, `testing-e2e`→`testing-unit` — each with its reason. Any other
> same-tier edge fails `@entifix/tiers`, and so does a declaration no manifest
> takes any more.
>
> Deliberately not kept: the handful of _downward_ edges the old ordering also
> forbade, such as `core`→`tooling`. Nothing takes one, and a downward edge that
> hands an adopter an unwanted capability is what the optional-capability rule
> below exists for.

### The invariant is not about direction

⚠️ **A downward edge can still be illegal.** Three of the four composition defects
found when these tiers were first drawn point _downward_: `react-controls`→`i18n`,
the datastore adapters→`transactions`, and `testing-e2e`→three database drivers.
Every one is legal by tier order and every one hands an adopter a capability they
did not ask for. (The fourth, `next-shell`→`authn`, left the framework entirely.)

So the rule is: **a hard dependency on a capability its tier is meant to be
adoptable without is a build failure.** Such an edge is expressed as a
`peerDependencies` entry carrying `peerDependenciesMeta.optional`, reached through
a declared subpath export.

⚠️ **The subpath is not decoration — it is the part that works.** Package-level
dependencies are not per-subpath. `@entifix/mongo` and `@entifix/mongo/transactions`
share one manifest, so the only way the outbox can be optional is for the peer to
be optional and the subpath to be the thing that needs it.

The canonical case is the one the tiers were drawn around. `react-controls`
declares the translator itself — `useTranslateKey`, an `i18n-context` and a
fallback catalog — with `@entifix/i18n`, `i18next` and `react-i18next` as
**optional** peers, and ships the binding that uses them behind
`@entifix/react-controls/i18next`. A table therefore arrives without i18next
attached, and a host that wants the binding asks for it by importing the subpath.

The register is `tools/tiers/src/registry.ts` and `tiers.spec.ts` checks it in
both directions: a package under `packages/` missing from the register
fails, and a register entry naming a directory that does not exist fails. A
package carrying no `tier:` tag, or a tag disagreeing with the register, fails.

The optional capabilities today:

| capability              | optional for | otherwise installs                           |
| ----------------------- | ------------ | -------------------------------------------- |
| `@entifix/i18n`         | T1, T2, T3   | i18next, react-i18next and a Spanish catalog |
| `@entifix/transactions` | T2           | the transactional outbox and the saga engine |
| `@entifix/mongo`        | T5           | the `mongodb` driver                         |
| `@entifix/redis`        | T5           | the `ioredis` driver                         |
| `@entifix/amqp`         | T5           | the `amqplib` driver                         |

**An exemption is named one at a time, with its reason on the line.** There is one:
`@entifix/rest` hard-depends on `@entifix/transactions` because the REST save
adapter writes `makeCommandEnvelope` onto the wire and reads
`readTransactionAcceptedEnvelope` back. That envelope is the shape of a save in
this framework rather than an optional extra — the _sink_ is already optional at
runtime, asked for with `Effect.serviceOption`. A subpath there would hold the
whole of entity CRUD over REST. A new package in the tier still fails by default;
that is the point of naming exemptions rather than widening the rule.

### The seam takes values, never file paths

Four places had a host baked into framework code, and all four resolve the same
way: **entifix declares a port, the host supplies a value at composition.**

| what                     | entifix declares                                                      | a host supplies                                     |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------- |
| catalogs                 | a namespace per package for the copy it renders, and `defineCatalogs` | its own namespaces, merged, plus the typed-key gate |
| grants                   | `PolicyDecision`, `PolicyDecisionTag`, `can(grants, …)`               | its grant table                                     |
| cookie and storage names | neutral names, fixed, each declared by the package that reads it      | nothing                                             |
| the principal            | `TokenServiceTag`, `PolicyDecisionTag`                                | the Layers that verify a real token                 |

**A value, not a path.** A framework that takes `./config/roles.json` has to
resolve, read and parse it — it now owns a filesystem contract, a path convention
and a failure mode per host, none of which is its job. TypeScript is the default
supply, because a `Permission` is a template-literal type and
`Record<Role, readonly Permission[]>` makes a typo a compile error. JSON is
accepted, validated at the port through Standard Schema, for a host that must
configure at runtime.

**A `Layer`, a provider or a hook option wherever a composition root exists; a
module-initialization registry only where one does not.** There is exactly one of
the latter, and it is not a preference: `getServerT` is called directly inside
React server components scattered across an application, with nothing in between
to thread a parameter through. So catalogs are installed by `defineCatalogs(…)`,
once, from a module every entry point imports — and the failure mode is made loud,
an `EntifixBuildError` naming the call to make, rather than a silent empty default.

⚠️ **The typed-key gate is the one seam that cannot be split.** TypeScript permits
exactly one `declare module 'i18next' { interface CustomTypeOptions }` per
compilation; a second is `TS2717: subsequent property declarations must have the
same type`. So catalogs are owned per package but the _type_ gate is composed by
the host, in about ten lines. Every `useT` call site reads exactly as before. What
an adopter gains is a file they must write, and it belongs in the README rather
than in a paragraph they reach after the first compile error.

⚠️ **The registry is installed once per bundle, not once per application.** A Next
application's server and client are separate bundles with separate module state.
Installing only from a `'use client'` provider leaves every server render throwing
`No i18n catalogs are installed`, and no unit spec can see it because specs
install catalogs themselves. A host installs from its root layout for the server
graph and from its provider for the client.

### Each package owns its namespace

`controls` ships with `react-controls`; `entity` and `errors` ship with `core`;
`shell` ships with `next-shell`. Those never vary per host, so `useT('controls')`
stays internally typed forever and a framework string is never a host's problem.
What crosses the seam is a translator instance and a locale — never a catalog.
Which locales exist, and which is the default, is the host's too: core declares
none of its own ([ADR 0005](0005-content-an-entity-describes.md)).

### Names in the framework are neutral, and fixed rather than configurable

The session cookies `entifix_at`, `entifix_sid`, `entifix_did` and the locale
cookie `entifix_locale` are declared in `core`, beside the helpers that read them.
The bus exchange `entifix.events` and its `entifix.events.dlx` are declared in
`amqp`. The two IndexedDB database names — `entifix-workspace` in `next-shell`,
`entifix-ui-preferences` in `react-controls` — are declared where the store they
name is opened.

Fixed, not an option, and that is the deliberate half. A cookie name that varies
per host is a name every middleware, route handler and test helper must be handed;
the configuration cost lands on every call site to buy a rename nobody needs. A
host adopts the names.

The exception is a key that was **already** a parameter: `react-controls`' theme
`storageKey` and its UI-preferences namespace keep taking a value, and what
changed is only that their defaults are now `'entifix-theme'` and `'entifix-ui'`
rather than a product's name. A neutral default is not the same decision as a
seam, and this record does not turn one into the other.

⚠️ **`testing-e2e` re-declares the three cookie names rather than importing
them**, and the reason is a resolution one rather than a tier one. Nx builds the
project graph by loading every e2e project's `playwright.config.ts` in plain Node
— no source condition, nothing built — and that config reaches
`playwright/session.ts`. An `import … from '@entifix/core'` there resolves core's
`dist`, which a CI job that only lints never builds, and the whole graph fails
with `Cannot find module …/dist/index.js`. It passes on a developer machine only
because `dist` is left over from a previous build. The duplication is checked
rather than trusted: `session-cookies.spec.ts` imports core and fails if the two
drift.

### Public API is what a package exports

Exported from `index.ts`, or reachable through a declared subpath export, is
public. Everything else is internal and may change in a patch. Today that is 24
packages and 24 subpaths.

> **2026-10-23 ([ADR 0006](0006-the-public-contract-is-entities-use-cases-and-ports.md)).**
> Exported is public, and public is also bounded: a contract entry exports
> entities, use cases and ports, a mechanism lives at a subpath of its own, and
> no contract makes its caller construct a mechanism.

Neither versioning rule below means anything without this line: without it, every
file in `src/` is API and no change is ever a patch.

Subpath exports therefore do double duty — they are the API surface _and_ the unit
an optional peer hangs off. Adding one is an API decision, not a file-layout
decision.

### Fixed versioning, first release `0.1.0`

All 25 packages carry one version and move together. No compatibility matrix to
maintain, and every entifix-to-entifix peer — `workspace:*` here, an exact version
once published — is trivially correct because there is only ever one version in
play. Peers on the outside world (`effect`, `react`, `i18next`) stay ranges; those
are the adopter's to satisfy.

At `0.x` a breaking change rides the minor: `0.1.x` is the patch channel and
`0.2.0` is the breaking channel. Both consumers upgrade together.

Independent versioning stays available. **The trigger to revisit is `1.0.0`, or
earlier if a consumer ships to someone who cannot upgrade on our schedule** — at
`0.x` the matrix is real work and the version noise is cosmetic, and that trade
inverts the moment an upgrade stops being ours to schedule.

### This collection starts at 0001; r10c's records stay in r10c

All 59 of r10c's records stay there. They are one connected body — supersessions
run across them and the reasoning behind `@entifix/next-shell` is inseparable from
the back office it was drawn for. Two collections numbering from a shared origin
would collide on the next decision either side took.

entifix source cited **42** of those records, **337** times, at extraction. A
citation of that kind is a dead reference for any reader who cannot open the
other repository, and the plan here was to rewrite each one as this collection
wrote the record that replaced it, with an appendix mapping every number to a
one-line summary in the meantime.

> **2026-10-23.** The rewrite was done as one pass rather than as a long tail:
> each citation now carries the reasoning it stood for, or points at a record
> here. Two facts made the pass necessary rather than tidy. The appendix was
> about to stop covering the citations, because r10c's records **0001–0007
> share numbers with this collection's**, and a comment written before these
> existed — "ADR 0007's second ceiling" — read as a citation of the wrong
> record. And a stated rule is one the next comment written in a hurry skips.
> So `@entifix/docs-check` now fails on any r10c reference in `packages/`,
> `examples/` or `tools/`, on any `ADR NNNN` that is not a record here, and on a
> link into `docs/adr/` that does not resolve. The documents may still tell this
> history, and an attributed "r10c's ADR 0059" is allowed in them and nowhere
> else. The appendix is removed.

## Consequences

- **Back-compat is a real constraint here, and it is new.** Nothing in this
  repository inherits r10c's "no compatibility shims" rule. What replaces it is
  the versioning channel above, not a dual-read window.
- **An adopter's first task is the i18n augmentation**, before anything renders.
  Ten lines, and a wrong one is a compile error rather than a runtime surprise —
  but it is the first thing they meet, so the README opens with it.
- **Three packages ship unexercised.** `@entifix/zitadel`, `@entifix/jwt` and
  `@entifix/posthog` have unit tests and no example. The README says so, rather
  than letting an adopter infer coverage from their presence.
- **The register is a declaration, not a scan, and has to be edited by hand.** A
  scan can only say what the code currently does; the point of a register is to
  say what it is _allowed_ to do. Adding a package means adding a line, and
  forgetting is a build failure rather than a silent pass.
- **No source cites a record it cannot reach.** The citations are rewritten,
  and `@entifix/docs-check` keeps a new one from landing.

## What this record does not decide

The publishing mechanism (npm provenance, the release workflow), the local
development loop between this repository and its consumers, and the three example
applications. Each is its own decision in this collection — the examples are
[ADR 0004](0004-the-examples-are-the-composability-proof.md).
