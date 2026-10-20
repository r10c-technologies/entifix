import {
  defineLocales,
  type EntityFieldDescriptor,
  resetLocales,
} from '@entifix/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installSpecCatalogs } from '../../../i18n/spec-support/catalogs.js';
import { LocalizedFieldControl } from './localized-field-control.js';

const descriptor = (
  extra: Partial<EntityFieldDescriptor> = {},
): EntityFieldDescriptor => ({
  name: 'title',
  key: 'title',
  label: 'Title',
  type: 'localized',
  sortable: true,
  filterable: true,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
  resetOnClone: false,
  ...extra,
});

beforeEach(() =>
  defineLocales({ locales: ['en', 'es', 'pt'], defaultLocale: 'en' }),
);
afterEach(() => {
  resetLocales();
  installSpecCatalogs();
});

describe('LocalizedFieldControl', () => {
  it('renders one input per declared locale, the first carrying the id', () => {
    render(
      <LocalizedFieldControl
        descriptor={descriptor()}
        value={{ en: 'Soup', es: 'Sopa' }}
        onChange={() => undefined}
        id="title"
      />,
    );

    expect(screen.getByLabelText('Title (en)')).toHaveValue('Soup');
    expect(screen.getByLabelText('Title (en)')).toHaveAttribute('id', 'title');
    expect(screen.getByLabelText('Title (es)')).toHaveAttribute(
      'id',
      'title-es',
    );
    expect(screen.getByLabelText('Title (pt)')).toHaveValue('');
    expect(screen.getByLabelText('Title (pt)')).toHaveAttribute('lang', 'pt');
  });

  it('emits the whole map with one locale changed', () => {
    const onChange = vi.fn();
    render(
      <LocalizedFieldControl
        descriptor={descriptor()}
        value={{ en: 'Soup' }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Title (es)'), {
      target: { value: 'Sopa' },
    });

    expect(onChange).toHaveBeenCalledWith({ en: 'Soup', es: 'Sopa' });
    expect(screen.getByLabelText('Title (es)')).not.toHaveAttribute('id');
  });

  it('disables every input of a read-only member', () => {
    render(
      <LocalizedFieldControl
        descriptor={descriptor({ readonly: true })}
        value={{}}
        onChange={() => undefined}
        aria-invalid
      />,
    );

    for (const input of screen.getAllByRole('textbox')) {
      expect(input).toBeDisabled();
      expect(input).toHaveAttribute('aria-invalid', 'true');
    }
  });
});
