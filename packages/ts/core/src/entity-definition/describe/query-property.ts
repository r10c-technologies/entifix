import type { Locale } from '../../i18n/locales.js';
import { isLocalizedText, localize } from '../../i18n/localized-text.js';
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
 * The property a filter or sort names for a member, and how one of its values
 * reads, in a given locale — the pair a control that both queries a member and
 * shows it needs. A `localized` member is queried as `title.<locale>` and read
 * in that locale (falling back to the default one); any other member is its
 * wire key and reads as itself.
 */
export function localizedQueryProperty(
  descriptor: EntityFieldDescriptor,
  locale: Locale,
): {
  readonly property: string;
  readonly read: (value: unknown) => string | undefined;
} {
  return {
    property: queryPropertyFor(descriptor, locale),
    read: value => {
      if (value == null) return undefined;
      if (descriptor.type === 'localized') {
        return isLocalizedText(value) ? localize(value, locale) : undefined;
      }
      return String(value);
    },
  };
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
