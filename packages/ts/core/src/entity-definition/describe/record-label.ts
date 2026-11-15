import type { Entity, EntityConstructor } from '../../types/Entity.js';
import { extractMetaEntity, findMetaEntity } from '../helpers/index.js';
import type { ChildConstructor } from '../meta-entities/meta-accessor/index.js';
import {
  COLLECTION_TYPES,
  describeEntityColumns,
  type EntityFieldDescriptor,
} from './describe-entity-columns.js';

/** How many characters of a long id a fallback label shows. A whole UUID never reads. */
export const SHORT_ID_LENGTH = 8;

/**
 * What a record is called, before it is put into words. Core knows neither the
 * reader's locale nor the entity's translated noun, so it answers with what to
 * show and leaves the words to the presentation layer:
 *
 * - `value` — a member's own value, read through its descriptor (a localized
 *   text in the reader's locale, a number formatted);
 * - `reference` — the name of the record another entity holds under `id`,
 *   which the host's reference registry resolves;
 * - `fallback` — nothing names the record: the entity's noun with
 *   {@link shortId} of its id, when it has one.
 */
export type RecordLabel =
  | {
      readonly kind: 'value';
      readonly member: EntityFieldDescriptor;
      readonly value: unknown;
    }
  | {
      readonly kind: 'reference';
      readonly member: EntityFieldDescriptor;
      readonly entity: string;
      readonly id: string;
    }
  | { readonly kind: 'fallback'; readonly shortId?: string };

const described = new WeakMap<ChildConstructor, EntityFieldDescriptor[]>();

function descriptorsOf(target: ChildConstructor): EntityFieldDescriptor[] {
  let descriptors = described.get(target);
  if (descriptors === undefined) {
    descriptors = describeEntityColumns(target);
    described.set(target, descriptors);
  }
  return descriptors;
}

/** Holds something a person could read: not empty, and a localized text in at least one locale. */
function isFilled(descriptor: EntityFieldDescriptor, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (descriptor.type === 'localized') {
    return (
      typeof value === 'object' &&
      Object.values(value).some(text => typeof text === 'string' && text !== '')
    );
  }
  return true;
}

/**
 * Whether a member can name a record it was not declared to name. One that
 * holds a key or a list never can: an id, a reference and a link are keys,
 * and a collection is many values.
 */
export function canNameRecord(descriptor: EntityFieldDescriptor): boolean {
  return (
    descriptor.type !== 'id' &&
    descriptor.type !== 'link' &&
    descriptor.references === undefined &&
    !COLLECTION_TYPES.includes(descriptor.type)
  );
}

function labelFrom(
  descriptor: EntityFieldDescriptor,
  value: unknown,
): RecordLabel {
  return descriptor.references === undefined
    ? { kind: 'value', member: descriptor, value }
    : {
        kind: 'reference',
        member: descriptor,
        entity: descriptor.references.entity,
        id: String(value),
      };
}

/**
 * What a record is called — the **one derivation** every surface that names a
 * record goes through: a row's title and checkbox, a card's heading, a confirm
 * dialog's object, a breadcrumb, a toast, the typed delete policy. In order:
 *
 * 1. the entity's declared `labelMember`, or the member it declares the card's
 *    `title`, when filled in — a reference is answered as one, to resolve;
 * 2. the first filled-in member that is neither an id, a reference, a link nor
 *    a collection;
 * 3. the fallback: the noun and the id's {@link shortId}.
 *
 * `record` is read by member name, so an entity instance, a plain record and a
 * form's draft all work; a record not loaded yet is called by the noun alone.
 */
export function recordLabel(
  entityConstructor: ChildConstructor,
  record: object | undefined,
): RecordLabel {
  const values = (record ?? {}) as Record<string, unknown>;
  const descriptors = descriptorsOf(entityConstructor);
  const declaredName =
    findMetaEntity(entityConstructor)?.labelMember ??
    descriptors.find(descriptor => descriptor.card === 'title')?.name;
  const declared = descriptors.find(
    descriptor => descriptor.name === declaredName,
  );
  if (declared !== undefined && isFilled(declared, values[declared.name])) {
    return labelFrom(declared, values[declared.name]);
  }
  const undeclared = descriptors.find(
    descriptor =>
      canNameRecord(descriptor) &&
      isFilled(descriptor, values[descriptor.name]),
  );
  if (undeclared !== undefined) {
    return labelFrom(undeclared, values[undeclared.name]);
  }
  const id = values['id'];
  return id === undefined || id === null || id === ''
    ? { kind: 'fallback' }
    : { kind: 'fallback', shortId: shortId(String(id)) };
}

/**
 * Ids no longer than this are quoted whole: `offering-12` cut to eight
 * characters would name every offering alike, while a UUID is never short.
 */
export const SHORT_ID_WHOLE = 12;

/**
 * What a label quotes of an id when nothing names the record: a short id
 * whole, a long one cut to its first {@link SHORT_ID_LENGTH} characters.
 */
export function shortId(id: string): string {
  return id.length <= SHORT_ID_WHOLE ? id : id.slice(0, SHORT_ID_LENGTH);
}

/**
 * The `domain:key` an entity is referenced by — the pair its
 * `@entity({ domain, key })` declares, which is also its permission namespace.
 * Throws for an entity that declares only one of them: nothing could reference
 * it.
 */
export function entityReferenceKey<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): string {
  const { domain, key, name } = extractMetaEntity(entityConstructor);
  if (domain === undefined || key === undefined) {
    throw new Error(
      `${name} needs both a domain and a key to be referenced — a reference names its target as "domain:key".`,
    );
  }
  return `${domain}:${key}`;
}
