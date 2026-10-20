import { describe, expect, it } from 'vitest';

import type { EntityFieldDescriptor } from './describe-entity-columns.js';
import { findQueriedDescriptor, queryPropertyFor } from './query-property.js';

const descriptor = (
  name: string,
  extra: Partial<EntityFieldDescriptor> = {},
): EntityFieldDescriptor => ({
  name,
  key: name,
  label: name,
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
  ...extra,
});

const code = descriptor('code', { key: 'item_code' });
const title = descriptor('title', { key: 'item_title', type: 'localized' });

describe('queryPropertyFor', () => {
  it('names the wire key, or one locale of a localized member', () => {
    expect(queryPropertyFor(code, 'en')).toBe('item_code');
    expect(queryPropertyFor(title, 'es')).toBe('item_title.es');
  });
});

describe('findQueriedDescriptor', () => {
  it('finds a member by name, wire key or locale path', () => {
    expect(findQueriedDescriptor([code, title], 'code')).toBe(code);
    expect(findQueriedDescriptor([code, title], 'item_code')).toBe(code);
    expect(findQueriedDescriptor([code, title], 'item_title.es')).toBe(title);
    expect(findQueriedDescriptor([code, title], 'title.en')).toBe(title);
  });

  it('finds nothing for a path into a member that is not localized', () => {
    expect(
      findQueriedDescriptor([code, title], 'item_code.en'),
    ).toBeUndefined();
  });
});
