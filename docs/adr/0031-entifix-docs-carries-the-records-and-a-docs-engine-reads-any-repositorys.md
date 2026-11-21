# 31. `@entifix/docs` carries the records, and a docs engine reads any repository's

- Status: Proposed
- Date: 2026-11-16
- Revised: 2026-11-21 by [#275](https://github.com/r10c-technologies/entifix/issues/275) — the engine landed: guides are Markdown through unified rather than `fumadocs-mdx`, a dark palette is named by `data-scheme`, and the seven conditions are met on `example-docs`
- Area: platform
- Read when: a site shows entifix's decision records from a clone or a copy rather than from what is installed, a record parser is about to be written a second time, a docs page is about to be built by hand that a record, a use case or a package already describes, choosing between `fumadocs-ui` and a shell on `@entifix/react-controls`, or a fumadocs upgrade arrives

## Context

entifix's records are read in three places today, and no two read them alike.

- **The build checks them.** `tools/docs/src/corpus.ts` parses the
  `- Area:` and `- Read when:` headers, and `@entifix/docs-check` fails a
  record missing either, a dead link, or a one-way supersession.
- **The first adopting site copies them.** myself-app's `tools/sync-adrs.mjs`
  parses the same headers a second time (`readRecord`, `statusOf`,
  `summaryOf`, `rewriteLinks`), reads entifix's records from a clone at
  `$ENTIFIX_REPO`, writes `adrs.json` and one Markdown body per record, and
  answers `--check` for its own records only: CI has no entifix clone, so
  entifix's copies are refreshed by hand and drift silently.
- **The second adopter links them.** r10c's router lists entifix's records by
  URL at a pinned tag (`blob/v0.22.4/docs/adr/…`), and its docs check fails
  when the installed version and the links disagree.

So the records reach their readers by clone, by copy and by URL, and none of
those is the version the reader has installed. A record corrected in place
(README, "Correcting a record") reaches nobody until someone re-syncs by hand.

A documentation site is now planned for both repositories: a reference
generated from metadata (entities, use cases, permissions, endpoints), guides
that cite use cases by id, the records, and Storybook beside them. Building it
twice, once per repository, would put the record format, the loader and the
id check in two places — the same drift, one level up.

Measured before deciding the shell (spike 2026-11-17, Next 16.4.3, static
export, `@entifix/style` linked):

- `fumadocs-core` is headless — a loader turns a **virtual source** into a
  page tree, with no file-system assumption — so a source built from records,
  from entity metadata or from Markdown is a function, not a plugin.
- `fumadocs-ui` under entifix's tokens reached **0 axe violations** (WCAG 2.2
  AA tags, `target-size` included) on three pages × two palettes × two widths
  and with the mobile sidebar open, after three changes:
  1. `--color-fd-primary` darkened to `color-mix(primary 75%, content)`.
     Primary text on a primary tint is not a pair in
     [ADR 0025](0025-the-token-contract.md)'s table and measured 4.09–4.36:1.
  2. High-contrast shiki themes. entifix has no syntax palette.
  3. A global `:focus-visible` ring on `--color-focus-ring`. Without it, the
     accordion trigger, the tab panel and the mobile table of contents showed
     no focus indicator at all, which axe cannot see.
- One defect stays: the search dialog's Close button is labelled
  "Close Search" and reads "ESC" (2.5.3 `label-content-name-mismatch`), and no
  prop changes it.
- Dark mode can have **one owner**: next-themes switched off
  (`RootProvider theme={{ enabled: false }}`), `dark:` re-pointed at
  `data-theme`, and three shiki rules mirrored. fumadocs knows only light and
  dark, so `dark:` follows the palettes declared dark.
- Not measured: 1.4.11 control boundaries (fumadocs' inputs use the decorative
  border, not `--color-border-control`), forced colours, and 2.4.11 focus
  obscured by the sticky header.

## Decision

### 1. `@entifix/docs` is content: the records, an index, and the format that reads them

`@entifix/docs` ships:

- **`records/`** — every `docs/adr/NNNN-*.md` and the README, as they stand
  at the release;
- **`records.json`** — the index, one entry per record: number, title,
  status (and what supersedes it), date, area, `Read when`, `Revised` count,
  and the decision's points — the shape myself-app's `adrs.json` already has;
- **`@entifix/docs/reader`** — the reader both of those come from:
  `readRecords(directory, { areas })` parses a collection in this format and
  answers the index or the problems it found. It is the one parser:
  `@entifix/docs-check` imports it instead of `corpus.ts`'s own `header()`,
  and a host reads its own collection with it. Its rules are the README's.
  The area list is a parameter, because r10c files records under areas
  entifix does not have.

Later releases add entifix's core documentation (the package guides, the
tier contract, the accessibility conformance report) under `guides/`. The
package carries **content and its format only** — no React, no Next, no
entity class. A host that wants records as entities declares its own class
and reads `records.json` through `@entifix/static`, as myself-app does now.

### 2. It is tier 0, and it takes the fleet's version

- **Tier 0, standalone.** The reader is plain Node over `node:fs`. The
  package depends on no other package of ours and on nothing that renders.
  It is registered in `tools/tiers/src/registry.ts` like any other package,
  so the register's rules hold it: `files` covers what `exports` names, it
  ships its LICENSE, `publishConfig.access` is public.
- **One version with the rest.** Its `tier:0` tag places it in the `nx
release` group (`tag:tier:*`) and under the "carries one version across the
  register" check, so `@entifix/docs@0.23.0` holds the records as they stood
  when `0.23.0` was cut. A host reading records from `node_modules` reads the
  version of the decisions it installed.
- ⚠️ **A record edited in place reaches npm with the next release, not
  with the commit.** A `docs:` commit cuts no version (ADR 0003). That is the
  intended reading — the records describe the code at the version — and it
  also means a correction waits for the next `feat:` or `fix:`.

### 3. The site engine is a separate package: `@entifix/docs-engine`

The engine is **not** in `@entifix/docs`. Content that every adopter can read
must not arrive with Next, fumadocs and a second UI stack attached
([ADR 0001](0001-the-tier-contract-and-the-host-seam.md): a dependency is a
capability you install).

- **Where they live.**
  - `@entifix/docs-engine` is in `packages/next/docs-engine`.
  - `@entifix/docs` is in `packages/docs`, which needs a line of its own in
    `pnpm-workspace.yaml`, as `packages/style` has.
  - The private `@entifix/docs-check` tool keeps its name.
- **Tier 4, beside `@entifix/next-shell`**: it is an application framework
  for one kind of Next app. It depends on `@entifix/docs` (the reader),
  `@entifix/style` (the tokens) and `@entifix/react-controls` (the theme
  provider and switcher, which own `data-theme`).
- **Sources, not pages.** The engine turns sources into one `fumadocs-core`
  page tree:
  - a **records source** over any collection the reader reads;
  - a **guides source**, Markdown with directives;
  - a **reference source**, a function the host writes from its own metadata.
    The engine knows no host's entities.

  Each source is a `StaticSource`.

- **A guide that cites an unknown id fails the build.** `:use-case[id]` and
  its siblings are resolved against an id registry the host passes in. An
  unknown directive or id stops `next build` with the file and the line —
  myself-app's directive rule ("a typo is caught where it was made"),
  generalized.
- **Static export, `trailingSlash: true`, search on Pagefind** over the
  exported HTML, one index per instance. No server: a docs site is files.
- **Two instances, one engine.** entifix's instance publishes its own records,
  the package reference and Storybook under one origin. Each host's instance
  is its own app over the same engine. The engine never imports a host.

### 4. The shell is `fumadocs-ui`, under conditions it does not yet meet

The spike passed, so the shell is `fumadocs-ui`. It enters behind the
`@entifix/docs-engine/ui` subpath, with `fumadocs-ui` as an **optional peer**.
`fumadocs-core` stays a dependency of `.`. If an upgrade fails a gate it cannot
be made to pass, the fallback is a subpath swap to a shell on
`@entifix/react-controls`, and the rest of the engine does not move.

**`next` is bumped first.** Next 16.4.3 printed a "known security
vulnerability" notice in the spike's build and intermittently failed it with
`SecurityFatalError`. entifix's catalog moves past it, after checking the
official advisory, before the engine adds a Next app.

**Pinned exactly:** `fumadocs-core` and `fumadocs-ui` `16.17.10`.
`fumadocs-ui` pins `fumadocs-core` exactly and peers `next 16.x.x`, so the two
move together and only together. `fumadocs-mdx` is not used: a page is
Markdown, never MDX, and runs through `unified` with fumadocs-core's own
remark and rehype plugins. A source is a function over files the host already
has, and an MDX compiler would put a second content pipeline beside it.

**What the engine applies:**

- `--color-fd-*` is mapped to `@entifix/style` tokens. Only
  `fumadocs-ui/css/preset.css` is imported, never its own `neutral.css` or
  `style.css`.
- The primary-on-tint fix, the high-contrast shiki themes and the global
  `:focus-visible` ring from the spike.
- `RootProvider` runs with the theme switched off. A palette the host declares
  dark (`darkPalettes`) sets `data-scheme="dark"` on `<html>`, and fumadocs'
  `dark:` and the code blocks' dark theme follow that attribute — a stylesheet
  cannot be parameterised by a list, an attribute can. entifix's theme script
  sets the first paint, because an export has no server cookie to read, and
  the engine's scheme script runs right after it.

**What the adoption must close before this record is Accepted.** Each is a
gate, not a wish:

1. A **custom `SearchDialog`** whose Close button's name contains its visible
   text (2.5.3), with every string from the catalog.
2. **Control boundaries at 3:1 (1.4.11).** fumadocs' search button and inputs
   are remapped to `--color-border-control`, and the boundary is measured.
3. **Forced colours.** Every control stays visible and every focus shows,
   checked under `forced-colors: active`.
4. **Focus not obscured (2.4.11)** by the sticky header, at both widths.
5. **One focus indicator per control.** The global ring is de-duplicated
   where fumadocs already draws `ring-fd-ring`.
6. **No literal in JSX.** fumadocs' English UI text goes through its
   `translations` from the controls catalog, behind a wrapper the
   `react/jsx-no-literals` gate can see.
7. **The probe is a gate.** The spike's axe, Tab-ring and 24px script runs in
   Change Validation against the exported entifix instance
   ([ADR 0024](0024-wcag-2-2-aa-and-the-gates-that-ratchet-to-it.md)), and
   again on every fumadocs bump.

**As built (2026-11-21).** All seven are met on `examples/docs`, the exported
example site, and `example-docs-e2e` is the gate: axe at WCAG 2.2 AA with
`target-size` and entifix's keyboard walk — a skip link first, an indicator on
every stop, none hidden under the header — on three pages × two palettes × two
widths, the mobile sidebar and the open search dialog, a measured 3:1 boundary
on the search trigger, one indicator per focused control, and the walk again
under `forced-colors: active`. Building it found four things the spike had
not:

- fumadocs puts a copy-link button inside every heading, and Pagefind indexed
  its label as part of the heading — every result read "…Copy the link to
  this section". The engine renders plain headings; the table of contents
  already links them.
- remark-directive parses an id with colons — `order:product-order:cancel`, a
  use case's shape — as nested directives. The citation reads them back whole.
- Pagefind 1.6 tolerates typos, so a made-up word still finds a near one.
  "No results" is a real state, but a nonsense query is not how to reach it.
- `@entifix/react-controls`' `ThemeProvider` reflected its default palette on
  its first commit, before it had read the stored one — the one frame the
  theme script exists to prevent. It now reflects nothing until it has read
  the cookie.

The record stays Proposed until the rest of the trigger holds: entifix's own
instance (#277) and myself-app reading the records from `node_modules`.

### 5. What graduates from myself-app's incubator

| From myself-app                                                                           | To                                                       | Why                                                                                      |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `tools/sync-adrs.mjs`'s parsing: `readRecord`, `statusOf`, `summaryOf`, the index shape   | `@entifix/docs/reader`                                   | It parses entifix's own format, and it is the second copy of `corpus.ts`'s header rules. |
| `rewriteLinks`, a record link to the site's page and any other link to the file on GitHub | `@entifix/docs-engine`, behind a `url()` the host passes | The page scheme is a site's.                                                             |
| The `$ENTIFIX_REPO` read                                                                  | deleted                                                  | myself-app reads `node_modules/@entifix/docs`, so `--check` runs in CI with no clone.    |
| The directive rule (`markdown/directives.ts`: an unknown directive stops the build)       | `@entifix/docs-engine`, as the reference directives      | The rule generalizes. The callouts and the figure stay the site's.                       |

**What stays in myself-app:**

- The `ArchitectureDecision` entity. Its `project` link is a site's
  relation.
- The decision explorer, timeline and lineage. They are a design over the
  index, and a second renderer of one format is not drift.
- The diagrams under `entifix-incubator/react-controls/diagrams`, until the
  r10c site's diagrams decide whether they share a control.

## Consequences

- One parser. `@entifix/docs-check` and every site read a record the same way,
  so a header the build accepts is one every site can render.
- myself-app's "records synced by hand" goes away. Its copies of entifix's
  records match the version it installed, and the check that they do runs in
  CI.
- The release goes from 25 packages to 27. npm's trusted publisher has to be
  bootstrapped by hand for `@entifix/docs` and for `@entifix/docs-engine`
  before the release can publish either (ADR 0003).
- The docs engine carries a second UI stack — radix, motion, lucide,
  next-themes — beside `@entifix/react-controls`'s. A docs page is about
  260 KB gzipped of JavaScript in the spike's export. It stays behind the `ui`
  subpath, so a host that only wants the loader does not install it.
- fumadocs releases several times a week and is pinned exactly. An upgrade is
  a deliberate bump with the probe re-run, never a range.
- Records ship in English. A site translates the page around them, not the
  record.

## Alternatives considered

- **One package holding the records and the engine.** Rejected: every reader of
  a record would install Next and fumadocs. A record collection is content,
  and tier 0 is where content that drags in nothing belongs.
- **Keep copying.** It is what drifts today, and its check cannot run where the
  other repository is absent.
- **A shell on `@entifix/react-controls` from the start.** It is already inside
  entifix's gates. The spike estimates two to three weeks, against three to
  five days for adopting `fumadocs-ui` under the gates above. It stays as the
  fallback, which the `ui` subpath keeps cheap.
- **Nextra.** It couples to its own content model. Its ideas — theme
  configuration as props, `_meta` beside content, Pagefind after build — are
  taken, its framework is not.

## Trigger

Promoted to **Accepted** when all of these hold:

- `@entifix/docs` is published at the fleet's version, with its records,
  `records.json` and `@entifix/docs/reader`, and registered in
  `tools/tiers`;
- `@entifix/docs-check` reads through that reader;
- myself-app's ADR sync reads entifix's records from `node_modules`, with
  `--check` green in CI and no clone;
- `@entifix/docs-engine` renders entifix's instance — records, a guide whose
  unknown id fails the build, and Pagefind search under a `basePath` — with
  the seven conditions of §4 met and the probe in Change Validation.

## Decisions confirmed (2026-11-17)

1. **The reader lives in `@entifix/docs`** (§1), not in the engine. The
   format belongs with the records, and neither `@entifix/docs-check` nor a
   site's sync should depend on a tier-4 package to read a Markdown header.
2. **A record corrected in place ships with the next release** (§2). `docs:`
   commits do not cut a version. Under fixed versioning a patch would bump all
   27 packages for a typo.
3. **`fumadocs-ui` is an optional peer behind `./ui`** (§4), so the
   `react-controls` fallback stays a subpath swap rather than a rewrite.
4. **`next` is bumped before the engine lands** (§4), past the 16.4.3
   security notice the spike's build printed, after checking the official
   advisory.

Carried as written, not raised separately:

- the name `@entifix/docs-engine` and the two directories (§3);
- fumadocs pinned at the measured 16.17.10 / 15.4.10 (§4);
- myself-app's decision explorer staying in myself-app (§5).
