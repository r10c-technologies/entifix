# CLAUDE.md

Guidance for Claude Code in this repository. Short on purpose: it states what
contradicts a reasonable default and links to where the reasoning lives. The
[README](README.md) is the adopter's view; the
[decision records](docs/adr/README.md) are the why.

entifix is an entity framework published to npm as 23 `@entifix/*` packages on
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
pnpm exec prettier --check .
pnpm nx sync                                   # tsconfig project references after adding deps

pnpm nx e2e @entifix/example-workspace-e2e     # hermetic journeys, a required check

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
  conventional commit types on `main`: `feat` bumps the minor, `fix` the patch,
  and `build`/`ci`/`chore`/`docs`/`test` release nothing. Pick the type for what
  it does to an adopter, not for how the diff feels.
  [ADR 0003](docs/adr/0003-releasing-without-a-credential.md).
- **Never rename `.github/workflows/release.yml`, and never add an npm
  credential.** Every package's npm trusted-publisher claim names that file and
  the `npm-publish` environment; renaming it breaks publishing for all 23
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
- **`Done` is the only required check.** `pull_request_check.yml` fans lint,
  build and test out over affected chunks behind one gate job. A new job must be
  added to `Done`'s `needs`, or it only advises. A change touching only a
  workflow affects no project and skips the matrices — prove it with
  `gh workflow run pull_request_check.yml --ref <branch>`.
- **A consumer sees unreleased work by copy, never by link.** A `link:` or
  `file:` specifier resolves `effect` from this repository and gives the consumer
  two copies, which breaks `Context.Tag` identity without an error. Use
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

A source comment citing a higher number (`ADR 0030`) means an r10c record; the
appendix of ADR 0001 maps each one.
