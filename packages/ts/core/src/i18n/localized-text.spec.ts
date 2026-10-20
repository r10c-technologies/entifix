import { afterEach, describe, expect, it } from 'vitest';

import { defineLocales, resetLocales } from './locales.js';
import { isLocalizedText, localize } from './localized-text.js';

afterEach(() => resetLocales());

describe('localize', () => {
  it("reads the reader's locale", () => {
    expect(localize({ en: 'Apple', es: 'Manzana' }, 'es')).toBe('Manzana');
  });

  it("falls back to the host's default for a missing or empty text", () => {
    defineLocales({ locales: ['es', 'en'], defaultLocale: 'es' });

    expect(localize({ es: 'Manzana' }, 'en')).toBe('Manzana');
    expect(localize({ es: 'Manzana', en: '' }, 'en')).toBe('Manzana');
  });

  it('answers undefined when neither has text, or there is no value', () => {
    expect(localize({ es: 'Manzana' }, 'en')).toBeUndefined();
    expect(localize(undefined, 'en')).toBeUndefined();
    expect(localize(null, 'en')).toBeUndefined();
  });
});

describe('isLocalizedText', () => {
  it('accepts a map of strings, and nothing else', () => {
    expect(isLocalizedText({ en: 'a', es: 'b' })).toBe(true);
    expect(isLocalizedText({})).toBe(true);
    expect(isLocalizedText({ en: 1 })).toBe(false);
    expect(isLocalizedText('a')).toBe(false);
    expect(isLocalizedText(null)).toBe(false);
    expect(isLocalizedText(['a'])).toBe(false);
    expect(isLocalizedText(new Date())).toBe(false);
  });
});
