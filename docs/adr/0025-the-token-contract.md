# 25. The token contract: contrast pairs, control borders, target size, and names that cannot collide

- Status: Proposed
- Date: 2026-11-05
- Area: ui
- Read when: adding or changing a palette or a preset, a host registers a runtime `ThemePalette`, a control is hard to see at rest or when focused, a menu item or option shows no active state, a target is under 24px at compact density, a dialog or palette renders a few pixels wide, or about to write a Tailwind arbitrary value or a colour literal

## Context

`@entifix/style` declares the tokens every control paints with:

- **Colour:** surface, content, primary, accent, border, danger, focus-ring.
- **Scales:** a fluid space and type scale, and a fixed-scale preset with a
  compact density (`data-scale` / `data-density`).
- **Palettes:** four presets, plus a runtime `ThemePalette` a host registers.

Nothing checked a token against WCAG. Computing all 133 used pairs for the
seven palettes on 2026-11-05 gave 33 failures:

- **Brand primary as a button label or as link text** fails 1.4.3 in three of
  the four light palettes and in a host palette registered at runtime: aurora
  4.39 and sunset 3.27, and two palettes an adopting host registers measured
  3.51 and 4.16.
- **`--color-border` against either surface is 1.18–1.62:1 in every palette.**
  Every text input, select and checkbox outline is under the 3:1 that 1.4.11
  asks of a control's boundary.
- **`surface` against `surface-elevated` is about 1.05:1.** Every state painted
  only as a background swap is invisible: the active menu item, the active
  combobox option, the active palette option.
- **`ThemePalette` has no `focus-ring` key,** so a runtime palette cannot keep
  its ring in contract.

What passes everywhere: `content` and `content-muted` on both surfaces (lowest
4.54), every `danger` pair (lowest 4.72), and `focus-ring` against both
surfaces (lowest 4.63).

Three gaps are structural rather than numeric:

- **There are no success, warning or info tones,** so status is either colour
  borrowed from `accent` or plain text. There is no scrim token: four overlays
  hardcode `bg-black/40`. There is no z-index scale: `z-50` and `z-60` are
  literals.
- **There is no target-size token.** Measured at fixed + compact, one control
  fails 2.5.8 outright (the tab-add button, 15.6×21.4). Every other small
  control passes only on the 24px spacing exception, about one pixel from
  failing.
- **The spacing scale and Tailwind's named sizes share names.** The fixed +
  compact preset sets `--spacing-xl: 2.5rem`, and Tailwind v4 resolves
  `max-w-xl` through `--spacing-xl` when it exists. The command palette's
  `max-w-xl` therefore renders 40px wide, and the same clash reaches
  `max-w-md` on ConfirmDialog and ToastRegion. It is not a development-only
  artefact: it is how the utility resolves.

## Decision

### Pairs are declared, and a spec holds every palette to them

`@entifix/style` ships a `tokens.spec`. It parses `tokens.css` and every preset,
and accepts any `ThemePalette` value a host passes it. For each palette it
asserts:

| Use                        | Pair                                                                           | Minimum |
| -------------------------- | ------------------------------------------------------------------------------ | ------- |
| Body and muted text        | `content`, `content-muted` on `surface`, `surface-elevated`                    | 4.5     |
| Link and ghost-button text | `primary` on `surface`, `surface-elevated`                                     | 4.5     |
| Filled-button label        | `primary-content` on `primary`; `danger-content` on `danger`                   | 4.5     |
| Accent used as text        | `accent` on both surfaces                                                      | 4.5     |
| Tone text                  | `success`, `warning`, `info`, `danger` on their `-subtle` and on both surfaces | 4.5     |
| Control boundary           | `border-control` on both surfaces                                              | 3       |
| Focus indicator            | `focus-ring` on both surfaces                                                  | 3       |
| Selected (not focused)     | `selected` on `surface-elevated`                                               | 3       |

The spec is exported as `assertPaletteContract(palette)` under a testing
subpath. A host registering its own palettes runs the same assertion over them.
A palette that cannot meet a pair is a palette that cannot ship.

### New and split tokens

- **`--color-border` stays decorative** — dividers, card edges — and may stay
  subtle. **`--color-border-control` is new** and is what every input, select,
  checkbox and switch track draws its boundary with.
- **`--color-selected`** marks a selected-but-not-focused item (a chosen row, a
  current option).
- **An active descendant** — a menu item, a palette option or a combobox option
  under the keyboard — **wears `focus-ring` on `[data-focus]`**, which the
  utility already supports. So focus has one visual language whether it is real
  focus or `aria-activedescendant`.
- **`--color-{success,warning,info}`, each with `-subtle` and `-content`,**
  beside `danger`.
- **`--color-scrim`** for overlay backdrops, and a **`--z-*` scale** —
  `dropdown`, `sticky`, `overlay`, `toast`, `palette` — replacing literals.
- **`ThemePalette` gains `focus-ring`, `border-control` and `selected`.**
  Omitting one is a type error, not a silent fallback.

### Target size

- **`--target-min: 24px`** in every scale and density.
- Every interactive control whose painted box may be smaller reaches it with a
  pseudo-element hit area, not padding that would change layout. That covers
  checkbox, switch, tab, tab close, tab add, `sm` buttons, overflow triggers,
  page numbers, breadcrumb links and sidebar group toggles.
- **The spacing exception of 2.5.8 is not relied on by design.** A control that
  passes only because nothing is near it fails the moment a host puts something
  near it.
- **Compact density may shrink what is painted, never what is hit.** The spec
  asserts the compact preset's computed control heights against `--target-min`.
- A host may raise the floor — 44px for touch-first surfaces — by overriding the
  token.

### Names cannot collide

- `@entifix/style` declares its own `--container-{xs…7xl}` widths, and no
  `--spacing-*` name equals a Tailwind named size.
- A check in `@entifix/tiers`' conventions fails on a class in
  `react-controls` or `next-shell` whose named `max-w-*`, `w-*`, `h-*`,
  `min-*` or `size-*` would resolve through `--spacing-*`.
- An arbitrary value (`[…]`) in a control is allowed only as `var(--token)`.
  The two literals that duplicate a token today (`h-[2rem]`, `duration-[120ms]`)
  are replaced.

### Forced colours

Controls keep a visible boundary and focus indicator under
`@media (forced-colors: active)`. Every boundary drawn as a background is backed
by a transparent border, and the focus ring falls back to `CanvasText`.

## Consequences

- Darkening aurora's and sunset's primary changes the brand look of both
  presets. That is accepted, because the alternative is a preset that fails the
  most common criterion on every button.
- The contract test fails on today's tokens, so it lands **with** the token
  values that pass it, in one change. That change cuts the component gate's todo
  list ([ADR 0024](0024-wcag-2-2-aa-and-the-gates-that-ratchet-to-it.md)) from
  about 10 titles to about 2.
- `--color-border-control` makes every input visibly bordered. That is a visible
  change in every adopting application, and is the point of 1.4.11.
- Adding three keys to `ThemePalette` is a breaking change to a public type and
  rides the minor (ADR 0003).

## Trigger

Promoted to **Accepted** by the change that lands `tokens.spec` green over every
preset, the new and split tokens, `--target-min` with the hit-area extension on
the listed controls, `--container-*` with the collision check, and
`ThemePalette`'s new keys.
