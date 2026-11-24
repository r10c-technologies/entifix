import type { EntityFieldDescriptor } from '@entifix/core';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityCrudLinkSource } from './make-entity-crud.types.js';
import { useEntityLinkSources } from './use-entity-link-sources.js';

const useEntityLinkSource = vi.fn((..._args: unknown[]) => ({}));
vi.mock('@entifix/react-integration', () => ({
  useEntityLinkSource: (...args: unknown[]) => useEntityLinkSource(...args),
}));
vi.mock('@entifix/react-controls', () => ({ useLocale: () => 'es' }));

const link = (
  field: string,
  type: EntityFieldDescriptor['type'],
): EntityCrudLinkSource =>
  ({
    field,
    descriptor: { name: field, type, references: { entity: 'a:b' } },
    config: {},
  }) as unknown as EntityCrudLinkSource;

const selectedIdFor = (call: number) =>
  (useEntityLinkSource.mock.calls[call]?.[1] as { selectedId?: string })
    .selectedId;

describe('useEntityLinkSources', () => {
  beforeEach(() => useEntityLinkSource.mockClear());

  it('reads the one held id of a reference', () => {
    renderHook(() =>
      useEntityLinkSources([link('brandId', 'string')], {
        values: { brandId: 'b-1' },
        selection: {},
      }),
    );
    expect(selectedIdFor(0)).toBe('b-1');
  });

  it('reads nothing for an unset reference', () => {
    renderHook(() =>
      useEntityLinkSources([link('brandId', 'string')], {
        values: { brandId: '' },
        selection: {},
      }),
    );
    expect(selectedIdFor(0)).toBeUndefined();
  });

  // A list names each of its ids itself, through the reference registry; a
  // comma list read as one id would be a lookup for a record that cannot exist.
  it('reads no single record for a list of references', () => {
    renderHook(() =>
      useEntityLinkSources([link('fits', 'scalarCollection')], {
        values: { fits: 'm-1,m-2' },
        selection: {},
      }),
    );
    expect(selectedIdFor(0)).toBeUndefined();
  });
});
