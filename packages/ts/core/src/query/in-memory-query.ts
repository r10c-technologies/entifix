import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import { EntityCollectionLink } from '../entity-definition/links/entity-collection-link/index.js';
import { EntityLink } from '../entity-definition/links/entity-link/index.js';
import type { Entity } from '../types/Entity.js';
import type {
  EntityFilter,
  EntityFiltering,
  FilterGroup,
} from '../types/EntityFiltering.js';
import type { EntitySorting } from '../types/EntitySorting.js';

/**
 * An {@link EntityLoadRequest}'s filtering and sorting, answered over records
 * held in memory, with the semantics of the Mongo adapter.
 *
 * One implementation for everything that queries records it holds itself — the
 * in-memory test double, the static repository, a published view — so none of
 * them can drift into a more forgiving version of the others. They used to be
 * separate copies, and one of them compared an array member with `===` and so
 * never matched `in` (#34).
 *
 * The rules, each Mongo's:
 * - a link is its target's id, a collection link the list of their ids;
 * - `in` and `nin` against an array match when **any element** does, as `$in`;
 * - a property may be a dotted path into a member holding an object, which is
 *   how a filter reaches one locale of a `localized` member (`name.en`);
 * - `like` is a case-insensitive substring match, as `$regex` with `i`;
 * - a missing value sorts below a present one, numbers and dates compare as
 *   themselves and anything else as text;
 * - every top-level filtering entry is combined with `and`.
 */

/**
 * A member as the Mongo adapter stores it, and so as its queries see it: a
 * link is its target's id, a collection link the list of their ids. Without
 * this no operator can compare a link, since `eq` against an id is never
 * `true` for an object.
 */
export function storedValue(value: unknown): unknown {
  if (value instanceof EntityLink) return value.id;
  if (value instanceof EntityCollectionLink) return value.ids;
  return value;
}

/**
 * The value a property names: a member, or a dotted path into one. A path
 * through something that is not an object ends in `undefined`, as a missing
 * field does in Mongo.
 */
export function valueAt(record: object, property: string): unknown {
  const [member, ...path] = property.split('.');
  return path.reduce<unknown>(
    (value, key) =>
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined,
    storedValue((record as Record<string, unknown>)[member as string]),
  );
}

/** Ordering with Mongo's rules; `0` for two values it considers equal. */
export function compareStoredValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  // Mongo sorts missing values below present ones.
  if (left == null) return right == null ? 0 : -1;
  if (right == null) return 1;
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  return String(left).localeCompare(String(right));
}

/** Equality by value, so two `Date`s naming one instant are equal. */
const isEqual = (actual: unknown, value: unknown): boolean =>
  actual instanceof Date && value instanceof Date
    ? actual.getTime() === value.getTime()
    : actual === value;

/** `$in` semantics: a scalar matches a value, an array when any element does. */
const matchesAny = (actual: unknown, values: readonly unknown[]): boolean => {
  const matches = (element: unknown) =>
    values.some(value => isEqual(element, value));
  return Array.isArray(actual) ? actual.some(matches) : matches(actual);
};

/** Escapes a string so `like`/`nlike` match literally, as the Mongo adapter does. */
const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesLike = (actual: unknown, value: string): boolean =>
  actual != null && new RegExp(escapeRegex(value), 'i').test(String(actual));

const isFilterGroup = <TEntity extends Entity>(
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): node is FilterGroup<TEntity> =>
  !('property' in node) && (node.operator === 'and' || node.operator === 'or');

const isBetween = (actual: unknown, start: unknown, end: unknown) =>
  actual != null &&
  compareStoredValues(actual, start) >= 0 &&
  compareStoredValues(actual, end) <= 0;

/**
 * The values a dotted path reaches **through an array** — every element's
 * member — or `undefined` when the path crosses no array, so the caller reads
 * the single value as before.
 */
function valuesThroughArray(
  record: object,
  property: string,
): unknown[] | undefined {
  const dot = property.indexOf('.');
  if (dot === -1) return undefined;
  const elements = storedValue(
    (record as Record<string, unknown>)[property.slice(0, dot)],
  );
  if (!Array.isArray(elements)) return undefined;
  const member = property.slice(dot + 1);
  return elements.map(element =>
    typeof element === 'object' && element !== null
      ? valueAt(element as object, member)
      : undefined,
  );
}

/**
 * Splits a filter into its positive test and whether the operator negates it,
 * so a path into an array can ask "any element" of the positive form and
 * negate the answer — never "any element is not equal", which almost always
 * holds.
 */
function positiveTest<TEntity extends Entity>(
  filter: EntityFilter<TEntity>,
): { readonly test: (actual: unknown) => boolean; readonly negated: boolean } {
  switch (filter.operator) {
    case 'eq':
    case 'ne':
      return {
        test: actual => isEqual(actual, filter.value),
        negated: filter.operator === 'ne',
      };
    case 'gt':
      return {
        test: actual =>
          actual != null && compareStoredValues(actual, filter.value) > 0,
        negated: false,
      };
    case 'gte':
      return {
        test: actual =>
          actual != null && compareStoredValues(actual, filter.value) >= 0,
        negated: false,
      };
    case 'lt':
      return {
        test: actual =>
          actual != null && compareStoredValues(actual, filter.value) < 0,
        negated: false,
      };
    case 'lte':
      return {
        test: actual =>
          actual != null && compareStoredValues(actual, filter.value) <= 0,
        negated: false,
      };
    case 'in':
    case 'nin':
      return {
        test: actual => matchesAny(actual, filter.values),
        negated: filter.operator === 'nin',
      };
    case 'between':
    case 'nbetween':
      return {
        test: actual => isBetween(actual, filter.start, filter.end),
        negated: filter.operator === 'nbetween',
      };
    case 'like':
    case 'nlike':
      return {
        test: actual => matchesLike(actual, filter.value),
        negated: filter.operator === 'nlike',
      };
    case 'isNull':
    case 'isNotNull':
      return {
        test: actual => actual != null,
        negated: filter.operator === 'isNull',
      };
    default: {
      // Exhaustiveness guard — a new operator must be handled explicitly.
      const never: never = filter;
      throw new EntifixBuildError(
        `Unknown filter operator "${String((never as { operator: unknown }).operator)}"`,
      );
    }
  }
}

function matchesFilter<TEntity extends Entity>(
  record: TEntity,
  filter: EntityFilter<TEntity>,
): boolean {
  const { test, negated } = positiveTest(filter);
  const property = String(filter.property);
  const elements = valuesThroughArray(record, property);
  const holds =
    elements === undefined
      ? test(valueAt(record, property))
      : elements.some(test);
  return negated ? !holds : holds;
}

function matchesNode<TEntity extends Entity>(
  record: TEntity,
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): boolean {
  if (!isFilterGroup(node)) return matchesFilter(record, node);
  return node.operator === 'or'
    ? node.values.some(child => matchesNode(record, child))
    : node.values.every(child => matchesNode(record, child));
}

/** Whether one record matches a request's filtering. */
export function matchesFiltering<TEntity extends Entity>(
  record: TEntity,
  filtering: readonly EntityFiltering<TEntity>[] | undefined,
): boolean {
  return (filtering ?? []).every(entry =>
    Array.isArray(entry)
      ? entry.every(child => matchesNode(record, child))
      : matchesNode(record, entry),
  );
}

/** The records a request's filtering keeps, in the order they were given. */
export function applyFiltering<TEntity extends Entity>(
  records: readonly TEntity[],
  filtering: readonly EntityFiltering<TEntity>[] | undefined,
): TEntity[] {
  return records.filter(record => matchesFiltering(record, filtering));
}

/**
 * The records in the order a request asks for, as a new array. `EntitySorting`
 * is a record keyed by priority rather than a list, so two keys cannot tie by
 * accident. No key leaves the order the records were given in.
 */
export function applySorting<TEntity extends Entity>(
  records: readonly TEntity[],
  sorting: readonly EntitySorting<TEntity>[] | undefined,
): TEntity[] {
  const keys = (sorting ?? []).flatMap(entry =>
    Object.keys(entry)
      .map(Number)
      .sort((left, right) => left - right)
      .map(priority => entry[priority])
      .filter(key => key != null),
  );
  if (keys.length === 0) return [...records];

  return [...records].sort((left, right) => {
    for (const key of keys) {
      const property = String(key.property);
      const compared = compareStoredValues(
        valueAt(left, property),
        valueAt(right, property),
      );
      if (compared !== 0) return key.type === 'desc' ? -compared : compared;
    }
    return 0;
  });
}
