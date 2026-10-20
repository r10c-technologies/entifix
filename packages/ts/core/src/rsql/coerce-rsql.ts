import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import {
  describeEntityColumns,
  type EntityFieldDescriptor,
} from '../entity-definition/describe/index.js';
import type { MetaAccessorType } from '../entity-definition/meta-entities/meta-accessor/index.js';
import { isLocale, type Locale } from '../i18n/locales.js';
import type { Entity, EntityConstructor } from '../types/Entity.js';
import type { EntityFilter, FilterGroup } from '../types/EntityFiltering.js';
import {
  isRawFilter,
  type RawFilter,
  type RawFilterGroup,
} from './parse-rsql.js';

/**
 * Resolves the members a client is allowed to name, keyed by both the accessor
 * name and its wire key so a URL may use either.
 *
 * `select` is what makes this an allowlist rather than a lookup: a member the
 * entity did not mark `filterable`/`sortable` is simply not in the map, and a
 * request naming it is rejected. That is the guard against a client filtering
 * on a `hidden` member or an unindexed one.
 */
export function allowedDescriptors<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  select: (descriptor: EntityFieldDescriptor) => boolean,
): Map<string, EntityFieldDescriptor> {
  const allowed = new Map<string, EntityFieldDescriptor>();
  for (const descriptor of describeEntityColumns(entityConstructor)) {
    if (!select(descriptor)) continue;
    allowed.set(descriptor.name, descriptor);
    allowed.set(descriptor.key, descriptor);
  }
  return allowed;
}

const reject = (message: string, details?: Record<string, unknown>) =>
  new EntifixBuildError(message, undefined, details);

/** A query property resolved against the allowlist. */
export interface AllowedProperty {
  readonly descriptor: EntityFieldDescriptor;
  /**
   * What an adapter names: the member's wire key, or for a `localized` member
   * the path to one locale's text (`title.en`).
   */
  readonly key: string;
  /** The locale a `localized` member is queried in. */
  readonly locale?: Locale;
}

/**
 * Resolves the property a filter or a sort names, or rejects it.
 *
 * A `localized` member is the one that takes a path: it holds an object, and
 * comparing an object as text matches nothing, so it is only ever queried
 * through one locale — `title.en` — and that locale must be one the host
 * declared. The bare member is rejected with a message that says so.
 */
export function resolveAllowedProperty(
  allowed: Map<string, EntityFieldDescriptor>,
  property: string,
  requirement: 'filterable' | 'sortable',
): AllowedProperty {
  const direct = allowed.get(property);
  if (direct !== undefined) {
    if (direct.type === 'localized') {
      throw reject(
        `"${property}" is localized; name one locale, as "${property}.<locale>"`,
        { property },
      );
    }
    return { descriptor: direct, key: direct.key };
  }

  const dot = property.indexOf('.');
  const descriptor =
    dot === -1 ? undefined : allowed.get(property.slice(0, dot));
  if (descriptor?.type !== 'localized') {
    throw reject(`"${property}" is not a ${requirement} member`, { property });
  }
  const locale = property.slice(dot + 1);
  if (!isLocale(locale)) {
    throw reject(`"${locale}" is not a declared locale`, { property });
  }
  return { descriptor, key: `${descriptor.key}.${locale}`, locale };
}

/** Re-types one raw argument from the member's declared type. */
function coerceValue(raw: string, descriptor: EntityFieldDescriptor): unknown {
  switch (descriptor.type as MetaAccessorType) {
    case 'number': {
      const value = Number(raw);
      if (raw.trim() === '' || Number.isNaN(value)) {
        throw reject(`"${raw}" is not a number for "${descriptor.name}"`);
      }
      return value;
    }
    case 'boolean': {
      if (raw !== 'true' && raw !== 'false') {
        throw reject(`"${raw}" is not a boolean for "${descriptor.name}"`);
      }
      return raw === 'true';
    }
    case 'date': {
      const value = new Date(raw);
      if (Number.isNaN(value.getTime())) {
        throw reject(`"${raw}" is not a date for "${descriptor.name}"`);
      }
      return value;
    }
    case 'enum': {
      if (descriptor.enumValues && !descriptor.enumValues.includes(raw)) {
        throw reject(`"${raw}" is not a value of "${descriptor.name}"`);
      }
      return raw;
    }
    default:
      return raw;
  }
}

function coerceFilter<TEntity extends Entity>(
  raw: RawFilter,
  allowed: Map<string, EntityFieldDescriptor>,
): EntityFilter<TEntity> {
  const { descriptor, key } = resolveAllowedProperty(
    allowed,
    raw.property,
    'filterable',
  );

  // The wire key is also the stored field name, so this is what the Mongo
  // translator downstream will use — dotted into one locale for a localized
  // member, which Mongo reads as a path natively.
  const property = key as keyof TEntity;
  const coerce = (value: string) => coerceValue(value, descriptor);

  if (raw.values) {
    return {
      property,
      operator: raw.operator,
      values: raw.values.map(coerce),
    } as EntityFilter<TEntity>;
  }
  if (raw.start !== undefined && raw.end !== undefined) {
    return {
      property,
      operator: raw.operator,
      start: coerce(raw.start),
      end: coerce(raw.end),
    } as EntityFilter<TEntity>;
  }
  if (raw.value !== undefined) {
    return {
      property,
      operator: raw.operator,
      value: coerce(raw.value),
    } as EntityFilter<TEntity>;
  }

  // `isNull`/`isNotNull` — no argument to coerce.
  return { property, operator: raw.operator } as EntityFilter<TEntity>;
}

function coerceNode<TEntity extends Entity>(
  node: RawFilter | RawFilterGroup,
  allowed: Map<string, EntityFieldDescriptor>,
): EntityFilter<TEntity> | FilterGroup<TEntity> {
  return isRawFilter(node)
    ? coerceFilter<TEntity>(node, allowed)
    : {
        operator: node.operator,
        values: node.values.map(child => coerceNode<TEntity>(child, allowed)),
      };
}

/**
 * Turns a parsed, untyped RSQL tree into a typed {@link FilterGroup} the
 * repositories can execute, validating it against the entity's metadata on the
 * way through.
 *
 * This is the trust boundary of the query protocol. Everything before it is a
 * string a client chose; everything after it names only members the entity
 * declared `filterable` and carries only values of those members' declared
 * types. A violation throws {@link EntifixBuildError}, which services already
 * map to a `400`.
 */
export function coerceFiltering<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  parsed: RawFilterGroup,
): FilterGroup<TEntity> {
  const allowed = allowedDescriptors(
    entityConstructor,
    descriptor => descriptor.filterable,
  );

  return {
    operator: parsed.operator,
    values: parsed.values.map(node => coerceNode<TEntity>(node, allowed)),
  };
}
