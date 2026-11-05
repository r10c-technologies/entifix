import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertPaletteContract,
  paletteContractFailures,
  type PaletteValues,
  parsePaletteCss,
} from './testing/index.js';

const read = (file: string) =>
  readFileSync(join(import.meta.dirname, file), 'utf8');

const defaults = parsePaletteCss(read('tokens.css'))['default'];
const presets = Object.assign(
  {},
  ...['aurora', 'sunset', 'midnight'].map(name =>
    parsePaletteCss(read(`presets/${name}.css`)),
  ),
) as Record<string, PaletteValues>;

// A preset overrides the defaults under its [data-theme]; what renders is the
// defaults with the preset on top, so that is what the contract holds.
const palettes: Record<string, PaletteValues> = {
  default: defaults,
  ...Object.fromEntries(
    Object.entries(presets).map(([id, p]) => [id, { ...defaults, ...p }]),
  ),
};

describe('the token contract (ADR 0025)', () => {
  it('reads the defaults and the three palette presets', () => {
    expect(Object.keys(palettes).sort()).toEqual([
      'aurora',
      'default',
      'midnight',
      'sunset',
    ]);
  });

  it.each(Object.entries(palettes))('%s meets every pair', (name, palette) => {
    expect(() => assertPaletteContract(palette, name)).not.toThrow();
  });

  it('declares a scrim and its target-size floor beside the colours', () => {
    const tokens = read('tokens.css');
    expect(defaults['scrim']).toBeDefined();
    expect(tokens).toMatch(/--target-min:\s*24px;/);
    for (const layer of ['dropdown', 'sticky', 'overlay', 'toast', 'palette']) {
      expect(tokens).toMatch(new RegExp(`--z-${layer}:\\s*\\d+;`));
    }
  });

  it('fails over aurora as it shipped before the contract', () => {
    const before = {
      ...defaults,
      primary: '#3b6ff5',
      accent: '#7c5cff',
      'border-control': '#dbe3ef',
    };
    const failing = paletteContractFailures(before).map(f =>
      f.kind === 'contrast'
        ? `${f.pair.foreground}/${f.pair.background}`
        : f.kind,
    );
    expect(failing).toEqual(
      expect.arrayContaining([
        'primary/surface',
        'primary/surface-elevated',
        'primary-content/primary',
        'accent/surface',
        'border-control/surface',
      ]),
    );
  });
});
