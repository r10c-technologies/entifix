import type { Locale } from '../../i18n/locales.js';
import type { EntityFieldDescriptor } from './describe-entity-columns.js';

/**
 * The property a filter or sort names for a member: its wire key, or for a
 * `localized` member the path to one locale's text — the only way one is
 * queried (`title.en`). A control building a query from a descriptor asks this
 * rather than reading `key`, so it never sends the bare object the server
 * refuses.
 */
export function queryPropertyFor(
  descriptor: EntityFieldDescriptor,
  locale: Locale,
): string {
  return descriptor.type === 'localized'
    ? `${descriptor.key}.${locale}`
    : descriptor.key;
}

/**
 * The member an applied filter or sort names — by its accessor name, its wire
 * key, or a locale path into a `localized` one — so a control can show what is
 * in effect.
 */
export function findQueriedDescriptor(
  descriptors: readonly EntityFieldDescriptor[],
  property: string,
): EntityFieldDescriptor | undefined {
  return descriptors.find(
    descriptor =>
      descriptor.key === property ||
      descriptor.name === property ||
      (descriptor.type === 'localized' &&
        (property.startsWith(`${descriptor.key}.`) ||
          property.startsWith(`${descriptor.name}.`))),
  );
}
