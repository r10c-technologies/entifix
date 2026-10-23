# 6. A package's public contract is entities, use cases and ports

- Status: Proposed
- Date: 2026-10-23
- Area: platform
- Read when: adding an export to a package's `.` entry, adding an option that takes a function or an adapter's product, adding a requirement to a port's `R` channel, or a consumer cannot write an import ban because a mechanism shares an entry point with a contract — a contract surface never makes its caller construct a mechanism, and the subpath is what a ban can name

## Context

[ADR 0001](0001-the-tier-contract-and-the-host-seam.md) decides which package may
depend on which, and that what a package exports is its public API. It says
nothing about what that API may _ask of its caller_. A package can sit in the
right tier, take only declared edges, and still hand every caller a mechanism it
has to build before the contract is usable.

That matters to a consumer for a reason the tier rule cannot see. A consumer
that wants its own code to talk to the framework only through ports — so a
persistence engine, a transport or a provider is chosen once, at composition —
can enforce that only with an import ban, and an import ban matches a
**specifier**. It can forbid `@entifix/rest`; it cannot forbid "the half of
`@entifix/transactions` that runs sagas". Wherever a mechanism shares an entry
point with a contract, the consumer's rule degrades from a build failure to a
review comment. This is the same observation 0001 makes about optional peers —
the subpath is the part that works — applied to the caller instead of the
installer.

An inventory of the 0.4.1 entry points found six places where using a contract
means constructing, or importing beside it, a mechanism:

| package             | where                                                     | what the caller is made to do                                                                                                                      |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `business`          | `EntityRepository`, every method                          | provide `ConfigurationRepositoryTag` — the REST adapter's URL lookup, leaked into the base port; a static or Mongo caller provides a dummy         |
| `next-shell`        | `makeEntityCrud({ metadataSource })`, `useUseCasesSource` | build an `EntityMetadataSource` at module time, which in practice means importing `makeEntityMetadataSource` from `@entifix/rest` into a UI file   |
| `react-integration` | `useTransactionSettlement({ read })`                      | assemble a status reader, its configuration and a `runPromise` inline, instead of passing a port built once                                        |
| `transactions`      | `.`                                                       | import contracts and ports from the entry that also exports `runSaga`, `resumeSaga`, `acceptTransaction`, the dispatcher and the stream hub        |
| `service-shell`     | `.`                                                       | import route guards from the entry that also exports `makeService`, remote configuration, OpenTelemetry wiring and the test server                 |
| `react-integration` | `.`                                                       | import `ReactiveChannelTag` from the entry that also exports `makeEventSourceReactiveChannel`, so choosing the transport and using it share a name |

The first three make a caller **construct** a mechanism; the last three make it
**reach past** one. Both end the same way: a file that should depend on a
contract imports a mechanism, and nothing can say it should not.

Product values shipped in framework code — copy, a default port, an environment
variable name — are a separate defect, and 0001's seam already decides them.

## Decision

### The contract surface is entities, use cases and ports

A package's `.` entry — and any subpath not named as a mechanism below — exports
what a caller **talks through**: entity metadata and decorators, use cases, ports
and their tags, pure contracts and types, and metadata-driven generic assets. It
does not export what a caller would **choose**: a client for an outside system,
a process runner, a transport, a telemetry pipeline.

### A mechanism sits behind a port, or at its own entry point

When a package holds both, the mechanism moves to a named subpath:

| package             | `.` keeps                                       | moves to                                                                                                                                                |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transactions`      | contracts, ports, mixins, the facade use case   | `./engine` — `runSaga`, `resumeSaga`, `resumeStaleSagas`, `acceptTransaction`, `completeTransaction`, the dispatcher, `resolveTemplate`, the stream hub |
| `service-shell`     | guards, generic routes                          | `./runtime` (`makeService`, remote configuration), `./observability`, `./testing`                                                                       |
| `react-integration` | `ReactiveChannelTag` and the hooks that read it | `./event-source` — `makeEventSourceReactiveChannel`                                                                                                     |

⚠️ **A subpath is required even when it adds no dependency.** `./engine` installs
nothing `.` does not; it exists so a ban can name it. Where a split _does_ separate
a dependency — `@effect/platform-node` under `./runtime`, the OpenTelemetry SDK
under `./observability` — that dependency becomes an optional peer by 0001's rule,
and the subpath does both jobs at once.

### A contract never makes its caller construct a mechanism

- **A port's requirements are its own.** A method's `R` channel names what the
  _port_ needs, never what one adapter needs to fulfil it. An adapter binds its own
  configuration when it is built, so `EntityRepository` requires nothing from its
  environment and a static or in-memory adapter provides nothing it does not use.
- **An option takes a port, or a key resolved at composition — never a function
  built from an adapter.** `makeEntityCrud` and `useUseCasesSource` resolve their
  metadata source through the adapters the host provided; `useTransactionSettlement`
  takes a `TransactionStatusReader` built once at the composition root.

### Generic assets are contract, bound per entity by the consumer

`makeEntityCrud` — and its backend twin when one exists — is contract surface. It
is generic over entity metadata, a consumer instantiates it once per entity, and
it obtains every mechanism it needs from composition rather than from an argument
the consumer had to build. That is what lets a consumer's binding of a generic
asset obey the same import ban as the rest of its code.

### The test

A file that imports only contract entries, and no adapter, compiles — and runs
once its host provides the Layers and adapters. Anything that fails that test
when it should pass is a violation of this record.

## Consequences

- **Four of the six are breaking and ride one minor**: the repository's
  requirement and the `transactions`, `service-shell` and `react-integration`
  entry-point splits, together in `0.5.0`. The other two
  (the metadata source and the settlement reader) are additive and ship on the
  patch channel first. No re-export is kept in `.` for a window — 0001 names the
  versioning channel as what replaces a compatibility path.
- **A consumer can write its layering as a ban list**, because every mechanism
  now has a specifier of its own.
- **Not checked yet.** The inventory above was done by hand, and nothing fails
  the build on a seventh case. The natural home is the register in
  `tools/tiers/src/registry.ts`, which already enumerates subpaths — classifying
  each as contract or mechanism, and asserting a contract entry re-exports no
  mechanism, is the follow-up this record leaves open.

## What this record does not decide

How a consumer arranges its own code around these contracts — which units it
groups by domain or by store, and which mechanism each is allowed to be. That is
the consumer's decision; this record only makes it enforceable.

## Trigger

Accepted when the release carrying the last of the six changes above is
published.
