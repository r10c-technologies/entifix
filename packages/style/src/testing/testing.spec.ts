import {
  assertPaletteContract,
  contrastRatio,
  PALETTE_PAIRS,
  PALETTE_TOKENS,
  paletteContractFailures,
  parseColor,
  parsePaletteCss,
} from './index.js';

const passing = Object.fromEntries(
  PALETTE_TOKENS.map(token => [
    token,
    token.startsWith('surface') ? '#ffffff' : '#000000',
  ]),
);
// Black on black has no contrast: give every content token its own ground.
const palette: Record<string, string> = {
  ...passing,
  'primary-content': '#ffffff',
  'danger-content': '#ffffff',
  'danger-subtle': '#ffffff',
  'success-subtle': '#ffffff',
  'warning-subtle': '#ffffff',
  'info-subtle': '#ffffff',
};

describe('parseColor', () => {
  it('reads short and long hex and both rgb() spellings', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor(' #0A0b0C ')).toEqual([10, 11, 12]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('rgb(1 2 3)')).toEqual([1, 2, 3]);
  });

  it('refuses alpha, out-of-range channels and other forms', () => {
    expect(parseColor('rgb(0 0 0 / 0.4)')).toBeUndefined();
    expect(parseColor('rgb(256 0 0)')).toBeUndefined();
    expect(parseColor('#ffff')).toBeUndefined();
    expect(parseColor('oklch(0.5 0.1 200)')).toBeUndefined();
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, 1 for a colour on itself, and symmetric', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([12, 34, 56], [12, 34, 56])).toBe(1);
    expect(contrastRatio([255, 255, 255], [118, 118, 118])).toBeCloseTo(
      contrastRatio([118, 118, 118], [255, 255, 255]),
    );
    // #767676 on white is the classic 4.54.
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(
      4.54,
      2,
    );
  });
});

describe('the pair table', () => {
  it('holds text to 4.5 and boundaries, rings and selection to 3', () => {
    for (const pair of PALETTE_PAIRS) {
      const nonText = ['border-control', 'focus-ring', 'selected'].includes(
        pair.foreground,
      );
      expect(pair.minimum).toBe(nonText ? 3 : 4.5);
    }
    expect(PALETTE_TOKENS).toContain('border-control');
    expect(PALETTE_TOKENS).not.toContain('border');
  });
});

describe('paletteContractFailures / assertPaletteContract', () => {
  it('passes a palette that meets every pair', () => {
    expect(paletteContractFailures(palette)).toEqual([]);
    expect(() => assertPaletteContract(palette)).not.toThrow();
  });

  it('reports a missing token once, however many pairs read it', () => {
    const rest = { ...palette };
    delete rest['surface'];
    const failures = paletteContractFailures(rest);
    expect(failures).toEqual([{ kind: 'missing', token: 'surface' }]);
    expect(() => assertPaletteContract(rest, 'ocean')).toThrow(
      /ocean breaks the token contract[\s\S]*missing --color-surface/,
    );
  });

  it('reports an unparseable value once', () => {
    const failures = paletteContractFailures({ ...palette, surface: 'tomato' });
    expect(failures).toEqual([
      { kind: 'unparseable', token: 'surface', value: 'tomato' },
    ]);
    expect(() =>
      assertPaletteContract({ ...palette, surface: 'tomato' }),
    ).toThrow(
      /palette breaks[\s\S]*not an opaque hex or rgb\(\) colour: tomato/,
    );
  });

  it('names the pair, the ratio and the minimum of a contrast failure', () => {
    const grey = { ...palette, 'focus-ring': '#eeeeee' };
    expect(paletteContractFailures(grey)).toEqual([
      expect.objectContaining({ kind: 'contrast', ratio: expect.any(Number) }),
      expect.objectContaining({ kind: 'contrast' }),
    ]);
    expect(() => assertPaletteContract(grey)).toThrow(
      /focus-ring on surface \(focus indicator\) is 1\.\d\d:1, needs 3:1/,
    );
  });
});

describe('parsePaletteCss', () => {
  it('reads @theme as default and every [data-theme] block, ignoring comments', () => {
    const css = `
      @theme { --color-surface: #fff; /* --color-content: #123; */ --spacing-s: 1rem; }
      [data-theme='a'] { --color-surface: #000; --color-primary: rgb(1 2 3); }
      [data-theme="b"] { color-scheme: dark; --color-surface: #111; }
      [data-theme='a'] { --color-accent: #222; }
    `;
    expect(parsePaletteCss(css)).toEqual({
      default: { surface: '#fff' },
      a: { surface: '#000', primary: 'rgb(1 2 3)', accent: '#222' },
      b: { surface: '#111' },
    });
  });
});
