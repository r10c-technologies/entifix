import { describe, expect, it } from 'vitest';

import { installSpecCatalogs } from '../i18n/spec-support/catalogs.js';
import { fallbackI18nextTranslator } from './index.js';

installSpecCatalogs();

describe('fallbackI18nextTranslator', () => {
  it('translates through the shared instance in the locale it is handed', () => {
    const english = fallbackI18nextTranslator('en');
    const spanish = fallbackI18nextTranslator('es');

    expect(english.locale).toBe('en');
    expect(english.t('controls', 'table.open')).toBe('Open');
    expect(spanish.t('controls', 'table.open')).toBe('Abrir');
    expect(english.formatters.number(1234.5)).toBe(
      new Intl.NumberFormat('en').format(1234.5),
    );
  });
});
