# 24. WCAG 2.2 AA is the target, and the gates ratchet toward it

- Status: Accepted
- Date: 2026-11-05
- Area: ui
- Read when: a control fails an accessibility check, adding a component or a story, a story renders blank while `build-storybook` stays green, writing an e2e journey that a screen-level check should cover, or about to add an axe rule exception, a jsx-a11y suppression or a `'todo'` entry

## Context

The agnostic layer (`@entifix/react-controls`, `@entifix/style`) is what every
screen of an adopting application is built from. A defect in it reaches every
screen at once, and so does a fix. Nothing measured that layer against a
standard. A baseline taken on 2026-11-05 found:

- **No accessibility test of any kind.** `axe-core` appears only as a transitive
  dependency of `eslint-plugin-jsx-a11y`. The plugin's rules are all at `warn`
  with no `--max-warnings`, so in effect they are off.
- **A Storybook that renders nothing for any entity.** Vite 8 leaves the stage-3
  decorators raw, so every story that instantiates an entity (EntityTable,
  EntityForm, EntityDetailGrid, EntityLinkInput — 22 stories) throws
  `SyntaxError` and renders an empty root. `build-storybook` stays green. The
  `main.ts` comment saying the default transform handles decorators is false.
- **No story at all for 24 of 48 component folders**, including every overlay:
  the command palette, ConfirmDialog, Drawer, ToastRegion and menus in their
  open state.
- **Measured over a corrected build:** 76 stories × 7 theme/scale/density cells
  give 34 unique violations, 1 critical and 33 serious, from 3 root causes.
  Brand-primary contrast and the TabStrip's tab structure explain almost all of
  them.

The standard is chosen for three reasons:

- WCAG 2.2 AA is the current W3C recommendation.
- EN 301 549 V4.1.1 (2 September 2026) moved its web baseline to WCAG 2.2 A/AA.
  That is the harmonised standard the European Accessibility Act points to, so a
  public library adopted by EU products is judged against it.
- Its 2.2 additions — 2.4.11 focus not obscured, 2.5.7 dragging, 2.5.8 target
  size, 3.2.6 consistent help, 3.3.7 redundant entry, 3.3.8 accessible
  authentication — land squarely on dense business UI.

Two facts shape _how_ the target is enforced:

- **Axe finds roughly a third of WCAG failures.** The rest — focus order,
  obscured focus, keyboard models, the meaning of an error — need deterministic
  scripted checks or judgement.
- **A gate switched on at zero violations blocks every pull request** until the
  backlog is gone, and nothing is measured meanwhile.

## Decision

### The target

**Every component and organism in `@entifix/react-controls`, and every shell
surface in `@entifix/next-shell`, conforms to WCAG 2.2 Level AA.** An adopting
host may narrow this — a higher level, a stricter target size — and never loosen
it. AAA criteria are not targets. Where one is cheap and the product benefits
(2.5.5 target size 44px for touch-first surfaces), the host decides.

### Stories must render, and every component has one

- `.storybook/main.ts` runs the same `unplugin-swc` pass (`decoratorVersion:
'2022-03'`) that `vitest.shared.mts` uses. A story that throws fails the
  Storybook test run, so a blank organism can no longer pass.
- Every `ui/{atoms,molecules,organisms}/<name>/` folder carries a
  `*.stories.tsx`. A component with an open state — menu, popover, dialog,
  drawer, toast, palette, disclosure — has a story that opens it through a
  `play` function. A conventions spec fails on a folder without a story.

### The component gate: addon-a11y under Vitest, ratcheted

- **Addons.** `@storybook/addon-a11y` and `@storybook/addon-vitest` are
  devDependencies of `@entifix/react-controls`. They are tooling, so there is no
  tier impact. The Vitest browser runner (`@vitest/browser-playwright`) sits at
  the workspace root beside Vitest itself: as a package devDependency it gave
  Vitest a second peer variant, and the jest-dom matchers augmented the other.
- **Preview parameters.**
  - `parameters.a11y.test: 'error'` globally.
  - `runOnly` = `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`, over the
    whole document rather than `#storybook-root`: dialogs, menus and toasts
    portal outside the root, and an overlay left open by a `play` function is
    exactly what the run is there to audit.
- **Globals.** The preview declares `scale` (fluid/fixed) and `density`
  (comfortable/compact) beside the theme, and a decorator writes `data-scale` /
  `data-density` on `<html>`.
- **Five Vitest projects** run every story through `initialGlobals`:
  - aurora-fluid
  - aurora-fixed-compact
  - midnight-fluid
  - midnight-fixed-compact
  - sunset-fixed

  Density was measured to change no axe result. It is covered by the
  target-size assertions of [ADR 0025](0025-the-token-contract.md), not by
  multiplying runs.

- **The ratchet is a committed `a11y-todo.json`:** story title → the issue that
  removes it.
  - A title listed there runs at `'todo'`: it reports but does not fail.
  - A spec fails on an entry whose issue is not an `owner/repo#N` reference or
    whose story title no longer exists.
  - The run fails on a stale entry: a listed title that raised no violation in
    any of the five cells (a reporter judges it, and only when every cell ran).
  - A daily workflow outside `Done` fails once a listed issue has closed with
    its entry still there.
  - The milestone that owns the list closes when the list is empty.
- **The target is its own `test-a11y`.** It is cacheable, its inputs include
  `.storybook/**` and `^default` (so a token edit in `@entifix/style` makes it
  affected), and it runs in Change Validation. It is **not** part of `test
--coverage`: stories are excluded from coverage, and a story run must not
  inflate the 100% unit gate.
- **One exception, written into the rule configuration with its reason.**
  `aria-hidden-focus` on Headless UI's focus sentinels, by narrowing the rule's
  selector to `[aria-hidden="true"]:not([id^="headlessui-focus-sentinel"])` —
  the rule's own selector with the sentinels removed, not a replacement for
  it. Any further exception needs an amendment
  to this record. The todo list is for defects, never for false positives.

### The screen gate: a helper the hosts call

- **`@entifix/testing-e2e/a11y`** is a new subpath, with `@axe-core/playwright`
  as an optional peer (ADR 0001).
- **`expectNoNewA11yViolations(page, { screen })`:**
  - runs the five tags;
  - fingerprints each node as `rule | normalizedTarget | screen`, writing
    React, Headless UI and Radix generated ids as `#generated-id`, collapsing
    repeated `:nth-child`, and sorting each compound's classes and attributes,
    which axe orders differently from one run to the next;
  - compares the result with the caller's committed baseline JSON, which maps
    each accepted fingerprint to the issue that removes it (`unownedEntries`
    names an entry without one);
  - **fails on a new critical or serious fingerprint, and on a baseline entry
    that no longer occurs**;
  - reports moderate and minor without failing.
- **`A11Y_BASELINE=update`** rewrites the file locally, keeping each owner and
  leaving a new entry's empty. CI fails when a baseline gains an entry relative
  to the merge base, so a rewrite can only shrink it; a baseline new at the
  merge base is the one place entries are added.
- **`walkKeyboard(page, options)`** is in the same subpath and is
  deterministic. It records each Tab stop and asserts:
  - a skip link is the first stop, when the caller says the shell has one
    (`skipLink: true`);
  - the first stop inside `main` is at or under `mainIndexMax`, counted after
    activating the skip link with Enter where there is one, and in raw Tab
    stops where there is not;
  - Tab order follows visual order (no stop starts more than one row above
    the previous stop in the same column);
  - no stop lacks a visible indicator (read once the page's finite animations
    have finished and never sooner than 200 ms after the focus move, because
    the ring transitions);
  - no stop's centre is covered by another element (2.4.11).
- **`expectFocusKept(page, { lostUntil? })`**, called after each write, fails
  when focus fell back to `<body>`. A write known to drop it names the issue
  that fixes it in `lostUntil`, and the check then fails once focus is kept,
  so the fix removes the mark — the baseline's ratchet, for one assertion.
- **Every example with a hermetic browser e2e calls both on every journey**
  ([ADR 0004](0004-the-examples-are-the-composability-proof.md)) — today
  `example-workspace-e2e` — so the helper is proven in this repository before
  a host adopts it.
- **Thresholds ratchet like fingerprints.** A host whose screens do not meet
  the walk's targets yet commits its measured values beside the issue that
  tightens them; the targets are a skip link first and `mainIndexMax` ≤ 3.

### Lint

- **This repository lints every package that renders with
  `eslint-plugin-jsx-a11y`'s `strict` set at error**, with component mappings —
  `Button`→button, `ButtonLink`→a, `TextInput`→input, `Select`→select,
  `Checkbox`→input — so the components themselves are held to it.
- **entifix ships no ESLint config package.** The runtime packages must not
  carry a lint plugin, and a config package would be a 25th publish target for
  a dozen lines. The README documents the recommended config and the component
  mappings, and a host applies `strict` itself.
- **No exception.** The five violations `strict` found were fixed rather than
  suppressed: three anchors now render their children explicitly, and the
  segmented control and split view take their arrow keys on the focused item
  rather than the non-focusable group. Headless UI's `data-autofocus` is not
  the `autoFocus` prop, so `no-autofocus` never fired. A conventions spec
  plants a clickable `<div>` in every rendering project and requires both
  keyboard rules at error.

## Consequences

- The first gate pull request lands with a todo list of 21 titles: the 24
  components that had no story were found to share the same contrast pairs.
  20 of them are the token pairs of ADR 0025, whose work cuts the list to
  about 1 in one change. That change is the
  evidence that the ratchet works rather than freezing a backlog.
- Writing a component now costs a story, and an interactive one a `play`
  function. That cost is the point: an overlay nobody can render is an overlay
  nobody can check.
- Five Storybook projects roughly quintuple story render time in CI. Measured
  locally at the baseline, 532 renders took under five minutes. The Nx cache
  takes the rest.
- Axe and the keyboard walk still miss screen-reader output and judgement. A
  host's manual pass remains necessary, and the published conformance report
  says which criteria were tested how.
- A host that needs a criterion this record does not gate — 3.3.8, which lives
  in its identity provider's login — states that in its own conformance report.
  This library cannot speak for a page it does not render.

## Status

Accepted with the release that follows **0.18.0**, which carries all five
changes: the Storybook decorator fix, a story for every component, `test-a11y`
with its todo list, jsx-a11y strict at error, and `@entifix/testing-e2e/a11y`
called on every journey of `example-workspace-e2e`.
