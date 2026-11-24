import {
  accessor,
  type Entity,
  entity,
  type EntityFieldDescriptor,
  type EntityId,
} from '@entifix/core';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { installSpecCatalogs } from '../../i18n/spec-support/catalogs.js';
import { I18nProvider } from '../../i18next/index.js';
import { CellValue } from '../atoms/cell-value/cell-value.js';
import { useRecordLabel } from '../atoms/cell-value/use-record-label.js';
import {
  type ReferenceLabelLookup,
  ReferenceLabelsProvider,
  type ReferenceLabelState,
  useReferenceLabel,
  useReferenceText,
  useUnresolvedReference,
} from './reference-labels.js';

installSpecCatalogs();

const ID = '79ce50c8-0a1b-4c2d-8e3f-1234567890ab';

/** A lookup answering every id of `catalog:offering` with one state. */
const lookupWith = (state: ReferenceLabelState): ReferenceLabelLookup => ({
  label: entityKey =>
    entityKey === 'catalog:offering' ? state : { status: 'unregistered' },
  noun: entityKey =>
    entityKey === 'catalog:offering'
      ? { name: 'Offering', key: 'offering' }
      : undefined,
});

const wrap =
  (lookup?: ReferenceLabelLookup, locale = 'es') =>
  ({ children }: { children: ReactNode }) => (
    <I18nProvider locale={locale}>
      {lookup === undefined ? (
        children
      ) : (
        <ReferenceLabelsProvider lookup={lookup}>
          {children}
        </ReferenceLabelsProvider>
      )}
    </I18nProvider>
  );

const reference = (entity = 'catalog:offering'): EntityFieldDescriptor => ({
  name: 'offeringId',
  key: 'offeringId',
  label: 'Offering',
  type: 'string',
  sortable: true,
  filterable: true,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
  resetOnClone: false,
  references: { entity },
});

const renderReference = (
  lookup: ReferenceLabelLookup | undefined,
  value: unknown = ID,
  entityKey?: string,
  locale?: string,
) =>
  render(<CellValue value={value} descriptor={reference(entityKey)} />, {
    wrapper: wrap(lookup, locale),
  });

describe('a reference cell', () => {
  it('holds a skeleton while the name resolves, never the id', () => {
    const { container } = renderReference(lookupWith({ status: 'resolving' }));
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
    // Only a screen reader hears it, and it is never the whole id.
    expect(screen.getByText('offering 79ce50c8')).toHaveClass('sr-only');
  });

  it('reads as its target name once named', () => {
    renderReference(lookupWith({ status: 'named', label: 'Flange' }));
    expect(screen.getByText('Flange')).toBeInTheDocument();
  });

  it('reads a localized name in the reader locale, marking a fallback language', () => {
    const { container, unmount } = renderReference(
      lookupWith({ status: 'named', label: { es: 'Brida', en: 'Flange' } }),
    );
    expect(screen.getByText('Brida')).not.toHaveAttribute('lang');
    unmount();
    renderReference(
      lookupWith({ status: 'named', label: { es: 'Brida' } }),
      ID,
      undefined,
      'en',
    );
    expect(screen.getByText('Brida')).toHaveAttribute('lang', 'es');
    expect(container).toBeDefined();
  });

  it.each(['notFound', 'failed'] as const)(
    'reads %s as the noun and the short id, muted, never the whole id',
    status => {
      renderReference(lookupWith({ status }));
      const text = screen.getByText('offering 79ce50c8');
      expect(text).toHaveClass('text-content-muted');
      expect(document.body.textContent).not.toContain(ID);
    },
  );

  it('names an entity with no noun by its key', () => {
    const lookup: ReferenceLabelLookup = {
      label: () => ({ status: 'notFound' }),
    };
    renderReference(lookup, 'o-1', 'catalog:product-offering');
    expect(screen.getByText('product-offering o-1')).toBeInTheDocument();
  });

  it('shows the raw id, muted, when nothing is registered to read it', () => {
    renderReference(undefined, 'o-1');
    expect(screen.getByText('o-1')).toHaveClass('text-content-muted');
  });

  it('is empty when it holds no id', () => {
    renderReference(lookupWith({ status: 'resolving' }), '');
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('a list of references', () => {
  const list: EntityFieldDescriptor = {
    ...reference(),
    name: 'offeringIds',
    key: 'offeringIds',
    type: 'scalarCollection',
  };
  const names: ReferenceLabelLookup = {
    label: (_entity, id) =>
      id === 'o-1'
        ? { status: 'named', label: 'Flange' }
        : id === 'o-2'
          ? { status: 'named', label: 'Valve' }
          : { status: 'notFound' },
    noun: () => ({ name: 'Offering', key: 'offering' }),
  };

  it('reads as each record named, in the order held', () => {
    render(<CellValue value={['o-2', 'o-1']} descriptor={list} />, {
      wrapper: wrap(names),
    });
    expect(
      screen.getByText('Valve').parentElement?.parentElement,
    ).toHaveTextContent('Valve, Flange');
  });

  it('is empty when it holds no id', () => {
    render(<CellValue value={[]} descriptor={list} />, {
      wrapper: wrap(names),
    });
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('useReferenceText', () => {
  const text = (lookup: ReferenceLabelLookup | undefined, locale = 'es') =>
    renderHook(() => useReferenceText('catalog:offering', ID), {
      wrapper: wrap(lookup, locale),
    }).result.current;

  it('is the name when one was read', () => {
    expect(text(lookupWith({ status: 'named', label: 'Flange' }))).toBe(
      'Flange',
    );
  });

  it('reads a localized name in the reader locale', () => {
    expect(
      text(
        lookupWith({ status: 'named', label: { es: 'Brida', en: 'Flange' } }),
      ),
    ).toBe('Brida');
  });

  it('falls back to the id when a localized name has no text at all', () => {
    expect(text(lookupWith({ status: 'named', label: {} }))).toBe(ID);
  });

  it('is the raw id when nothing is registered', () => {
    expect(text(undefined)).toBe(ID);
  });

  it('is the noun and short id when no record answered', () => {
    expect(text(lookupWith({ status: 'notFound' }))).toBe('offering 79ce50c8');
  });
});

describe('useReferenceLabel and useUnresolvedReference', () => {
  it('answers unregistered without a provider', () => {
    const { result } = renderHook(() => useReferenceLabel('a:b', 'x'), {
      wrapper: wrap(),
    });
    expect(result.current).toEqual({ status: 'unregistered' });
  });

  it('puts an unread reference into words', () => {
    const { result } = renderHook(() => useUnresolvedReference(), {
      wrapper: wrap(lookupWith({ status: 'failed' })),
    });
    expect(result.current('catalog:offering', ID)).toBe('offering 79ce50c8');
  });
});

describe('useRecordLabel', () => {
  @entity({ domain: 'shipping', key: 'shipment', labelMember: 'offeringId' })
  class Shipment implements Entity {
    constructor(readonly values: Record<string, unknown> = {}) {}
    @accessor({ type: 'id' })
    get id(): EntityId {
      return this.values['id'] as EntityId;
    }
    @accessor({ type: 'string', references: { entity: 'catalog:offering' } })
    get offeringId(): string {
      return this.values['offeringId'] as string;
    }
    @accessor({ type: 'number' })
    get weight(): number {
      return this.values['weight'] as number;
    }
  }

  const name = (lookup: ReferenceLabelLookup | undefined, record: object) =>
    renderHook(() => useRecordLabel(), {
      wrapper: wrap(lookup),
    }).result.current(Shipment, record);

  it('names a record by its reference target, as text or per locale', () => {
    expect(
      name(lookupWith({ status: 'named', label: 'Flange' }), {
        offeringId: 'o-1',
      }),
    ).toBe('Flange');
    expect(
      name(lookupWith({ status: 'named', label: { es: 'Brida' } }), {
        offeringId: 'o-1',
      }),
    ).toBe('Brida');
  });

  it('says the target noun and short id until the name is read', () => {
    expect(name(lookupWith({ status: 'resolving' }), { offeringId: ID })).toBe(
      'offering 79ce50c8',
    );
  });

  it('says the raw id when the host registered nothing', () => {
    expect(name(undefined, { offeringId: 'o-1' })).toBe('o-1');
  });

  it('names a record by a declared value as its cell reads it', () => {
    @entity({ domain: 'shipping', key: 'crate', labelMember: 'weight' })
    class Crate implements Entity {
      constructor(readonly values: Record<string, unknown> = {}) {}
      @accessor({ type: 'id' })
      get id(): EntityId {
        return this.values['id'] as EntityId;
      }
      @accessor({ type: 'number' })
      get weight(): number {
        return this.values['weight'] as number;
      }
    }
    const { result } = renderHook(() => useRecordLabel(), {
      wrapper: wrap(),
    });
    expect(result.current(Crate, { weight: 1500 })).toBe('1500');
  });

  it('never names a record by a number it was not declared to be called by', () => {
    expect(name(undefined, { id: ID, weight: 1500 })).toBe('shipment 79ce50c8');
  });

  it('calls a composition row without an entity by its class name', () => {
    class Line {
      @accessor({ type: 'id' })
      get id(): EntityId {
        return 'l-1';
      }
    }
    const { result } = renderHook(() => useRecordLabel(), {
      wrapper: wrap(),
    });
    expect(result.current(Line, { id: 'l-1' })).toBe('Line l-1');
  });

  it('falls back to the entity noun, with the short id when there is one', () => {
    expect(name(undefined, { id: ID })).toBe('shipment 79ce50c8');
    expect(name(undefined, {})).toBe('shipment');
  });
});
