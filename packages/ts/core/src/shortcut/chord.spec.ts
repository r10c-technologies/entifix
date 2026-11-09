import { describe, expect, it } from 'vitest';

import { assertChord, parseChord } from './chord.js';

describe('parseChord', () => {
  it('reads a chord into its parts, in one spelling', () => {
    expect(parseChord('shift+mod+s')).toEqual({
      text: 'Mod+Shift+S',
      key: 's',
      shift: true,
      alt: false,
    });
    expect(parseChord('Mod+Alt+Enter')).toEqual({
      text: 'Mod+Alt+Enter',
      key: 'enter',
      shift: false,
      alt: true,
    });
    expect(parseChord('Mod+Shift+Z').text).toBe('Mod+Shift+Z');
  });

  it('refuses a chord a shortcut may not take', () => {
    expect(() => parseChord('S')).toThrow(/holds Mod/);
    expect(() => parseChord('Shift+S')).toThrow(/holds Mod/);
    expect(() => parseChord('Mod+Alt+S')).toThrow(/Option/);
    expect(() => parseChord('Mod+C')).toThrow(/editing chord/);
    expect(() => parseChord('Mod+Ctrl+S')).toThrow(/not Mod, Alt or Shift/);
    expect(() => parseChord('Mod+')).toThrow(/names no key/);
    expect(() => assertChord('Mod+Shift')).toThrow(/names no key/);
  });
});
