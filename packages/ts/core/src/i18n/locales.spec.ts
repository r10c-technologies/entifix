import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultLocale,
  defineLocales,
  isLocale,
  locales,
  resetLocales,
} from './locales.js';

afterEach(() => resetLocales());

describe('locales', () => {
  it('is English alone until the host declares otherwise', () => {
    expect(locales()).toEqual(['en']);
    expect(defaultLocale()).toBe('en');
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(false);
  });

  it('follows what the host declared, default included', () => {
    defineLocales({ locales: ['es', 'en'], defaultLocale: 'es' });

    expect(locales()).toEqual(['es', 'en']);
    expect(defaultLocale()).toBe('es');
  });

  it('takes a locale entifix never shipped', () => {
    defineLocales({ locales: ['en', 'es', 'pt'], defaultLocale: 'en' });

    expect(isLocale('pt')).toBe(true);
  });

  it('keeps its own copy of the list', () => {
    const list = ['en', 'es'];
    defineLocales({ locales: list, defaultLocale: 'en' });
    list.push('fr');

    expect(locales()).toEqual(['en', 'es']);
  });

  it('rejects anything not declared, and anything not a string', () => {
    defineLocales({ locales: ['es', 'en'], defaultLocale: 'es' });

    expect(isLocale('fr')).toBe(false);
    expect(isLocale('es-MX')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });

  it('refuses a declaration that cannot be honoured', () => {
    expect(() => defineLocales({ locales: [], defaultLocale: 'en' })).toThrow(
      /at least one locale/,
    );
    expect(() =>
      defineLocales({ locales: ['en', 'en'], defaultLocale: 'en' }),
    ).toThrow(/"en" more than once/);
    expect(() =>
      defineLocales({ locales: ['en'], defaultLocale: 'es' }),
    ).toThrow(/"es" is not one of \["en"\]/);
    expect(locales()).toEqual(['en']);
  });
});
