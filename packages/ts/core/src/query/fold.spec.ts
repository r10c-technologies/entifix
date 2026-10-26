import { describe, expect, it } from 'vitest';

import {
  containsFolded,
  escapeRegex,
  FOLD_TABLE,
  foldedPattern,
  foldText,
} from './fold.js';

/** Searches and the stored text each must find — the rule every engine shares. */
const FOLDS: readonly (readonly [string, string])[] = [
  ['cafe', 'Café de Olla'],
  ['Café', 'CAFE'],
  ['nino', 'Niño'],
  ['niño', 'nino'],
  ['ÁRBOL', 'arbol'],
  ['pinguino', 'pingüino'],
  ['Łódź', 'łodz'],
];

describe('foldText', () => {
  it('takes accents and case off', () => {
    expect(foldText('ÁrBoL Niño Pingüino')).toBe('arbol nino pinguino');
  });

  it('leaves a letter that does not decompose as it is', () => {
    expect(foldText('Straße Ø')).toBe('straße ø');
  });
});

describe('FOLD_TABLE', () => {
  it('lists the base, its capital and every accented form in both cases', () => {
    expect(FOLD_TABLE['e']?.startsWith('eE')).toBe(true);
    expect(FOLD_TABLE['e']).toContain('é');
    expect(FOLD_TABLE['e']).toContain('É');
    expect(FOLD_TABLE['n']).toContain('ñ');
    expect(FOLD_TABLE['n']).toContain('Ñ');
  });

  it('has no entry for a letter with no accented form', () => {
    expect(FOLD_TABLE['b']).toBeUndefined();
  });
});

describe('foldedPattern', () => {
  it.each(FOLDS)('%s finds %s', (search, stored) => {
    // With `i`, as the Mongo adapter sends it. Only ASCII leans on the flag:
    // the accented letters are listed in both cases.
    const pattern = new RegExp(foldedPattern(search), 'i');
    expect(pattern.test(stored)).toBe(true);
  });

  it('matches metacharacters literally', () => {
    expect(new RegExp(foldedPattern('1.2')).test('132')).toBe(false);
    expect(new RegExp(foldedPattern('(a)')).test('(Á)')).toBe(true);
  });
});

describe('containsFolded', () => {
  it.each(FOLDS)('%s finds %s', (search, stored) => {
    // `ł` does not decompose, so it folds to itself on both sides alike.
    expect(containsFolded(stored, search)).toBe(true);
  });

  it('is a substring match', () => {
    expect(containsFolded('Café de Olla', 'de ol')).toBe(true);
    expect(containsFolded('Café', 'tea')).toBe(false);
  });
});

describe('escapeRegex', () => {
  it('escapes every metacharacter', () => {
    expect(escapeRegex('a.b*c+?^${}()|[]\\')).toBe(
      'a\\.b\\*c\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\',
    );
  });
});
