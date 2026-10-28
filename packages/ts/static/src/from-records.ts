import type { EntityRepository } from '@entifix/business';
import {
  deserializeEntityCollection,
  type Entity,
  type EntityConstructor,
  type ValidateRecordsOptions,
  validRecordsOrThrow,
} from '@entifix/core';
import { Effect } from 'effect';

import {
  makeStaticRepository,
  type StaticRepositoryOptions,
} from './static-repository.js';

export type StaticRecordsOptions = ValidateRecordsOptions &
  StaticRepositoryOptions;

/**
 * A static repository over untyped records — the JSON a build bundles —
 * checked against the entity's metadata before anything is served.
 *
 * The mapping assigns every non-relation value raw, so a record that is wrong
 * would otherwise reach a reader as `undefined` mid-page, or a date as a
 * string. `validRecordsOrThrow` from core runs first instead: identity,
 * `required`, each member's type, dates parsed, link ids against the targets
 * given, item counts, `notBefore`, cardinality, localized completeness, the
 * caller's rules — every problem collected, and thrown together as a
 * `InvalidRecords`, so a broken record fails the build rather than a
 * visitor's page.
 */
export function staticRepositoryFromRecords<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  records: readonly unknown[],
  options: StaticRecordsOptions = {},
): EntityRepository {
  const valid = validRecordsOrThrow(entityConstructor, records, options);
  const instances = Effect.runSync(
    deserializeEntityCollection(entityConstructor, valid),
  ) as TEntity[];
  return makeStaticRepository(entityConstructor, instances, options);
}
