# @entifix/style

Design tokens for Tailwind CSS v4. `tokens.css` declares the token **names** — typeface, spacing, type, radius, shadow, motion, focus, and a semantic `--color-*` contract — with neutral values. An application overrides the **values**, so a component never learns which application it runs in.

The default scale is fluid, built for reading. `presets/fixed-scale.css` swaps in a dense, fixed scale for operator screens without changing a single class name.

## Install

```sh
pnpm add -D @entifix/style
```

```css
@import 'tailwindcss';
@import '@entifix/style/tokens.css';
@import '@entifix/style/presets/aurora.css'; /* applies under [data-theme='aurora'] */
```

## Files

| Import                                                | What it holds                                          |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `@entifix/style/tokens.css`                           | Structural tokens and the color contract — import this |
| `@entifix/style/presets/fixed-scale.css`              | The dense scale, opted into per application            |
| `@entifix/style/presets/{aurora,sunset,midnight}.css` | Palette presets, each scoped to its `[data-theme]`     |
| `@entifix/style/theme.css`                            | Tokens plus all three palettes, for demos              |
| `@entifix/style/testing`                              | `assertPaletteContract`, for a host's own palettes     |

## The token contract

Every palette is held to a table of contrast pairs (WCAG 2.2 AA, [ADR 0025](https://github.com/r10c-technologies/entifix/blob/main/docs/adr/0025-the-token-contract.md)): text at 4.5:1, a control's boundary (`--color-border-control`), the focus ring and a selection marker (`--color-selected`) at 3:1. The presets here pass it, and a host holds its own palettes to it in a spec:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertPaletteContract, parsePaletteCss } from '@entifix/style/testing';

const tokens = fileURLToPath(import.meta.resolve('@entifix/style/tokens.css'));
const defaults = parsePaletteCss(readFileSync(tokens, 'utf8'))['default'];
const ours = parsePaletteCss(readFileSync('src/app/themes.css', 'utf8'));

for (const [name, palette] of Object.entries(ours)) {
  assertPaletteContract({ ...defaults, ...palette }, name);
}
```

The tokens also carry the tones (`success`, `warning`, `info` beside `danger`, each with `-subtle` and `-content`), `--color-scrim`, a `--z-*` layering scale, overlay sizes, and `--target-min` — the hit-area floor every control reaches, 24px unless a host raises it.

---

Tier 0 (standalone) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
