import type { EntityFacetCounter } from '@entifix/business';
import {
  allowedDescriptors,
  compareStoredValues,
  type Entity,
  type EntityConstructor,
  type EntityFacetCounts,
  type EntityFacetQuery,
  type EntityFacetValue,
  extractMetaEntity,
  InvalidQuery,
  resolveAllowedProperty,
} from '@entifix/core';
import { Effect } from 'effect';
import type { SqlClient, Statement } from 'effect/sql';

import { translateSqlError } from '../errors/translate-sql-error.js';
import { translateFiltering } from './sql-filter-translator.js';

const isFacetValue = (value: unknown): value is EntityFacetValue['value'] =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

/** Count first, highest first; a tie by value — the order core's counter keeps. */
const byCountThenValue = (left: EntityFacetValue, right: EntityFacetValue) =>
  right.count - left.count || compareStoredValues(left.value, right.value);

/**
 * Builds an {@link EntityFacetCounter} for one entity over an `@effect/sql`
 * client — the relational mirror of `makeMongoFacetCounter`, with the same
 * answers.
 *
 * One `GROUP BY` per facet, each under its own filtering, which goes through
 * the translator `load` uses, so a count and the page beside it cannot
 * disagree about what a filter means. A `scalarCollection` is counted per
 * element — `jsonb_array_elements` beside each row, as Mongo's `$unwind` — and
 * a missing or `null` value is not counted. A `localized` member is counted one
 * locale at a time (`title.en`), as it is filtered.
 *
 * Which member a request may count is the protocol's rule
 * (`parseFacetQueryParams`); the counter only refuses a member the entity does
 * not declare, since the name reaches SQL as an identifier.
 */
export function makeSqlFacetCounter<TEntity extends Entity>(
  sql: SqlClient.SqlClient,
  entityConstructor: EntityConstructor<TEntity>,
): EntityFacetCounter {
  const metaEntity = extractMetaEntity(entityConstructor);
  const table = sql(metaEntity.key ?? metaEntity.name);
  const declared = allowedDescriptors(entityConstructor, () => true);

  const statementFor = <T extends Entity>({
    member,
    filtering,
  }: EntityFacetQuery<T>): Statement.Statement<{
    readonly value: unknown;
    readonly count: number;
  }> => {
    const { descriptor, locale } = resolveAllowedProperty(
      declared,
      String(member),
      'filterable',
    );
    const column =
      locale === undefined
        ? sql`${sql(descriptor.key)}`
        : sql`${sql(descriptor.key)}->>${locale}`;
    const where = translateFiltering(
      sql,
      entityConstructor,
      filtering as Parameters<typeof translateFiltering<TEntity>>[2],
    );
    const filtered = where === undefined ? sql.literal('true') : where;
    return descriptor.type === 'scalarCollection'
      ? sql`
          SELECT element.value AS value, COUNT(*)::int AS count
          FROM ${table} CROSS JOIN LATERAL jsonb_array_elements(${column}) AS element(value)
          WHERE ${filtered}
          GROUP BY element.value`
      : sql`
          SELECT ${column} AS value, COUNT(*)::int AS count
          FROM ${table}
          WHERE ${filtered} AND ${column} IS NOT NULL
          GROUP BY ${column}`;
  };

  const count = <T extends Entity>(queries: readonly EntityFacetQuery<T>[]) =>
    Effect.gen(function* () {
      // The translators refuse an undeclared or unfilterable member by
      // throwing; that is the caller's query, answered as a 400.
      const statements = yield* Effect.try({
        try: () => queries.map(query => statementFor(query)),
        catch: error => new InvalidQuery({ reason: (error as Error).message }),
      });
      const counts: Record<string, readonly EntityFacetValue[]> = {};
      for (const [index, { member }] of queries.entries()) {
        const rows = yield* (
          statements[index] as (typeof statements)[number]
        ).pipe(Effect.mapError(error => translateSqlError(error)));
        counts[String(member)] = rows
          .filter(row => isFacetValue(row.value))
          .map(row => ({
            value: row.value as EntityFacetValue['value'],
            count: row.count,
          }))
          .sort(byCountThenValue);
      }
      return counts satisfies EntityFacetCounts;
    });

  return { count };
}
