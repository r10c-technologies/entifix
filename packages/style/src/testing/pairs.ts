/**
 * The pair table of ADR 0025. Every palette — a preset, an app-local
 * `[data-theme]` block, a runtime `ThemePalette` — is held to every row.
 * Token names are written without the `--color-` prefix, as a `ThemePalette`
 * writes them.
 */
export interface PalettePair {
  readonly use: string;
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
}

const SURFACES = ['surface', 'surface-elevated'] as const;
const TONES = ['danger', 'success', 'warning', 'info'] as const;

function onSurfaces(
  use: string,
  foregrounds: readonly string[],
  minimum: number,
): PalettePair[] {
  return foregrounds.flatMap(foreground =>
    SURFACES.map(background => ({ use, foreground, background, minimum })),
  );
}

export const PALETTE_PAIRS: readonly PalettePair[] = [
  ...onSurfaces('body and muted text', ['content', 'content-muted'], 4.5),
  ...onSurfaces('link and ghost-button text', ['primary'], 4.5),
  {
    use: 'filled-button label',
    foreground: 'primary-content',
    background: 'primary',
    minimum: 4.5,
  },
  {
    use: 'filled-button label',
    foreground: 'danger-content',
    background: 'danger',
    minimum: 4.5,
  },
  ...onSurfaces('accent used as text', ['accent'], 4.5),
  ...TONES.flatMap(tone => [
    {
      use: 'tone text',
      foreground: tone,
      background: `${tone}-subtle`,
      minimum: 4.5,
    },
    ...onSurfaces('tone text', [tone], 4.5),
  ]),
  ...onSurfaces('control boundary', ['border-control'], 3),
  ...onSurfaces('focus indicator', ['focus-ring'], 3),
  {
    use: 'selected (not focused)',
    foreground: 'selected',
    background: 'surface-elevated',
    minimum: 3,
  },
];

/** Every token the pair table reads. A palette missing one cannot be held to it. */
export const PALETTE_TOKENS: readonly string[] = [
  ...new Set(PALETTE_PAIRS.flatMap(p => [p.foreground, p.background])),
].sort();
