import type { EntityFieldDescriptor, MetaAccessorType } from '@entifix/core';

/**
 * A field descriptor as the metadata layer reports one, for stories of the
 * controls that take descriptors rather than an entity class.
 */
export const descriptor = (
  name: string,
  label: string,
  type: MetaAccessorType = 'string',
  extra: Partial<EntityFieldDescriptor> = {},
): EntityFieldDescriptor => ({
  name,
  key: name,
  label,
  type,
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

/** The members of the widget the table and form stories also use. */
export const WIDGET_FIELDS: readonly EntityFieldDescriptor[] = [
  descriptor('name', 'Name'),
  descriptor('stock', 'Units in stock', 'number'),
  descriptor('active', 'Active', 'boolean'),
  descriptor('releasedAt', 'Released', 'date'),
];
