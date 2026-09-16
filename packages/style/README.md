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

---

Tier 0 (standalone) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
