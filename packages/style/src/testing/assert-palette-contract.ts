import { contrastRatio, parseColor } from './contrast.js';
import { PALETTE_PAIRS, type PalettePair } from './pairs.js';

/** A palette as a `ThemePalette` writes it: token (no `--color-` prefix) → colour. */
export type PaletteValues = Readonly<Record<string, string | undefined>>;

export type PaletteFailure =
  | { readonly kind: 'missing'; readonly token: string }
  | {
      readonly kind: 'unparseable';
      readonly token: string;
      readonly value: string;
    }
  | {
      readonly kind: 'contrast';
      readonly pair: PalettePair;
      readonly ratio: number;
    };

/** Every way `palette` breaks ADR 0025's pair table, in table order. */
export function paletteContractFailures(
  palette: PaletteValues,
): PaletteFailure[] {
  const failures: PaletteFailure[] = [];
  const reported = new Set<string>();
  const read = (token: string) => {
    const value = palette[token];
    if (value === undefined) {
      if (!reported.has(token)) failures.push({ kind: 'missing', token });
      reported.add(token);
      return undefined;
    }
    const rgb = parseColor(value);
    if (!rgb && !reported.has(token)) {
      failures.push({ kind: 'unparseable', token, value });
    }
    reported.add(token);
    return rgb;
  };
  for (const pair of PALETTE_PAIRS) {
    const fg = read(pair.foreground);
    const bg = read(pair.background);
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio < pair.minimum) failures.push({ kind: 'contrast', pair, ratio });
  }
  return failures;
}

function describe(failure: PaletteFailure): string {
  switch (failure.kind) {
    case 'missing':
      return `missing --color-${failure.token}`;
    case 'unparseable':
      return `--color-${failure.token} is not an opaque hex or rgb() colour: ${failure.value}`;
    case 'contrast': {
      const { pair, ratio } = failure;
      return `${pair.foreground} on ${pair.background} (${pair.use}) is ${ratio.toFixed(2)}:1, needs ${pair.minimum}:1`;
    }
  }
}

/**
 * Throws unless `palette` meets every pair of ADR 0025. `name` labels the
 * message, so a host asserting several palettes can tell which one broke.
 */
export function assertPaletteContract(
  palette: PaletteValues,
  name = 'palette',
): void {
  const failures = paletteContractFailures(palette);
  if (failures.length === 0) return;
  throw new Error(
    `${name} breaks the token contract (ADR 0025):\n` +
      failures.map(f => `  - ${describe(f)}`).join('\n'),
  );
}
