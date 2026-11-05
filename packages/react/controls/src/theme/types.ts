/**
 * A selectable theme. `id` is written to `data-theme` on <html> and matched
 * against the CSS palette blocks; `label` is what the switcher renders.
 */
export interface ThemeOption {
  id: string;
  label: string;
}

/** The semantic color tokens an app may supply values for. Matches the
 *  `--color-*` contract declared in @entifix/style/tokens.css. */
export type ThemeColorToken =
  | 'surface'
  | 'surface-elevated'
  | 'content'
  | 'content-muted'
  | 'primary'
  | 'primary-content'
  | 'border'
  | 'border-control'
  | 'selected'
  | 'accent'
  | 'focus-ring'
  | 'danger'
  | 'danger-subtle'
  | 'danger-content'
  | 'success'
  | 'success-subtle'
  | 'success-content'
  | 'warning'
  | 'warning-subtle'
  | 'warning-content'
  | 'info'
  | 'info-subtle'
  | 'info-content'
  | 'scrim';

/**
 * The tokens a runtime palette must state. Each one is held to a contrast pair
 * against the palette's own surfaces (ADR 0025), so the neutral default cannot
 * stand in for it: a ring or a control boundary that clears 3:1 on grey may be
 * invisible on a brand's surface. Omitting one is a type error, not a silent
 * fallback.
 */
export type ThemePaletteRequiredToken =
  'focus-ring' | 'border-control' | 'selected';

/** A runtime palette: token → CSS color. Injected as `[data-theme]` vars for
 *  brands not known at build time (multi-tenant / white-label). Hold one to
 *  the contract with `assertPaletteContract` from `@entifix/style/testing`. */
export type ThemePalette = Partial<Record<ThemeColorToken, string>> &
  Record<ThemePaletteRequiredToken, string>;

/** How much room the UI takes: `fixed-scale.css` reads it as `data-density`. */
export type Density = 'comfortable' | 'compact';

export interface ThemeContextValue {
  /** Active theme id (written to `data-theme`). */
  theme: string;
  /** Chooses a theme, and remembers the choice. */
  setTheme: (id: string) => void;
  /** The registry this provider was configured with. */
  themes: ThemeOption[];
  /** Active density (written to `data-density`). */
  density: Density;
  /** Chooses a density, and remembers the choice. */
  setDensity: (density: Density) => void;
}
