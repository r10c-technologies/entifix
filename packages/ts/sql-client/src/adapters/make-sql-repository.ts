import { randomUUID } from 'node:crypto';

import type { EntityRepository, EntityWriteOptions } from '@entifix/business';
import {
  declaresRevision,
  describeEntityColumns,
  deserializeEntityCollection,
  deserializeSingleEntity,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityLoadRequest,
  type EntityPage,
  extractMetaEntity,
  holdsStoredState,
  InvalidQuery,
  NotFound,
  readRevision,
  serializeEntity,
  StaleRevision,
  type StoredStateCondition,
  storedStateCondition,
  unavailableInState,
} from '@entifix/core';
import { Effect } from 'effect';
import type { SqlClient } from 'effect/sql';

import { translateSqlError } from '../errors/translate-sql-error.js';
import {
  translateFiltering,
  translateSorting,
} from './sql-filter-translator.js';

/** A row as the driver returns it: column names, untransformed. */
type SqlRow = Record<string, unknown>;

function tableName<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): string {
  const metaEntity = extractMetaEntity(entityConstructor);
  return metaEntity.key ?? metaEntity.name;
}

/**
 * The columns stored as `jsonb`: a `scalarCollection`, one array each, and a
 * `localized` member, one text per locale.
 *
 * `jsonb` rather than `text[]` so a list keeps its elements' own types — a
 * number stays a number — and so one column type serves every element type.
 * The driver can infer a type for neither an array bound for `jsonb` nor a
 * plain object, so the row carries both as JSON text; they come back already
 * parsed.
 */
export function jsonColumns<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): ReadonlySet<string> {
  return new Set(
    describeEntityColumns(entityConstructor)
      .filter(
        descriptor =>
          descriptor.type === 'scalarCollection' ||
          descriptor.type === 'localized',
      )
      .map(descriptor => descriptor.key),
  );
}

/**
 * A serialized entity as the row the driver writes: every `jsonb` member as
 * JSON text. A `null` stays `null`, so the column holds SQL `NULL` and not the
 * JSON value `null`.
 */
export const toSqlRow = (
  serialized: Record<string, unknown>,
  json: ReadonlySet<string>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(serialized).map(([column, value]) => [
      column,
      json.has(column) && value !== null ? JSON.stringify(value) : value,
    ]),
  );

function toEntityId(entityOrId: EntityId | Entity): EntityId {
  return entityOrId != null && typeof entityOrId === 'object'
    ? (entityOrId as Entity).id
    : (entityOrId as EntityId);
}

/**
 * Builds an {@link EntityRepository} for a single entity type, backed by an
 * `@effect/sql` client. The `sql` client and `entityConstructor` are captured in
 * closures, so every method's Effect has no outstanding requirements
 * (`R = never`), which is exactly what the interface asks.
 *
 * This is the relational mirror of `makeMongoRepository`, and it is short for the
 * same reason: the entifix serializer is store-agnostic. `serializeEntity` emits
 * a **flat record keyed by `alias ?? name`**, which for a scalar entity *is* a
 * table row, and the deserializer consumes the same shape coming back. So the
 * entity's own `alias` metadata is the column mapping — there is no separate
 * table/column mapping layer, and none is needed.
 *
 * Table name = the entity's `key` (falling back to its class name), the same rule
 * the Mongo adapter uses for a collection.
 *
 * **v1 handles flat scalar entities**, plus a `scalarCollection` and a
 * `localized` member as one `jsonb` column each ({@link jsonColumns}). Embedded links and `linkCollection`
 * members have no single-column representation, so an entity carrying them needs
 * either a join-aware adapter or `alias`ed scalar foreign keys.
 *
 * Two dialect assumptions, both true of Postgres and stated so a future MySQL or
 * SQLite adapter knows what to override: `ILIKE` for case-insensitive matching,
 * and `COUNT(*)::int` for the total. The client must **not** be configured with
 * name transformation (`transformResultNames`), since `alias` is already the
 * mapping and a second one would fight it.
 */
export function makeSqlRepository<TEntity extends Entity>(
  sql: SqlClient.SqlClient,
  entityConstructor: EntityConstructor<TEntity>,
): EntityRepository {
  const table = sql(tableName(entityConstructor));
  const json = jsonColumns(entityConstructor);

  const load = <T extends Entity>(request: EntityLoadRequest<T>) =>
    Effect.gen(function* () {
      // The translators are framework-free and reject an undeclared member by
      // throwing, so the throw is caught back into the failure channel here —
      // the same crossing `readLoadRequest` makes for the URL codec.
      const clauses = yield* Effect.try({
        try: () => ({
          where: translateFiltering(
            sql,
            entityConstructor,
            request.filtering as EntityLoadRequest<TEntity>['filtering'],
          ),
          orderBy: translateSorting(
            sql,
            entityConstructor,
            request.sorting as EntityLoadRequest<TEntity>['sorting'],
            // Relevance weighs the words the filtering asks for (ADR 0033).
            request.filtering as EntityLoadRequest<TEntity>['filtering'],
          ),
        }),
        // The translator refuses a member the entity did not declare, by
        // throwing: that is the caller's query, answered as a 400.
        catch: error => new InvalidQuery({ reason: (error as Error).message }),
      });

      const where =
        clauses.where === undefined
          ? sql.literal('')
          : sql`WHERE ${clauses.where}`;
      const orderBy =
        clauses.orderBy === undefined
          ? sql.literal('')
          : sql`ORDER BY ${clauses.orderBy}`;

      const page = request.page ?? 1;
      const pageSize = request.pageSize ?? 10;
      const offset = (page - 1) * pageSize;

      const rows = yield* sql<SqlRow>`
        SELECT * FROM ${table} ${where} ${orderBy} LIMIT ${pageSize} OFFSET ${offset}
      `.pipe(Effect.mapError(error => translateSqlError(error)));

      const counted = yield* sql<{
        readonly count: number;
      }>`SELECT COUNT(*)::int AS count FROM ${table} ${where}`.pipe(
        Effect.mapError(error => translateSqlError(error)),
      );

      const items = yield* deserializeEntityCollection(entityConstructor, [
        ...rows,
      ]);

      return {
        items: items as unknown as T[],
        total: counted[0]?.count ?? 0,
        request,
      } satisfies EntityPage<T>;
    });

  const get = <T extends Entity>(id: EntityId) =>
    Effect.gen(function* () {
      const rows = yield* sql<SqlRow>`
        SELECT * FROM ${table} WHERE ${sql('id')} = ${id} LIMIT 1
      `.pipe(Effect.mapError(error => translateSqlError(error)));

      const entity = yield* deserializeSingleEntity(
        entityConstructor,
        rows[0] ?? null,
      );
      if (entity === undefined) {
        return yield* Effect.fail(
          new NotFound({ entity: extractMetaEntity(entityConstructor).key }),
        );
      }
      return entity as unknown as T;
    });

  const revised = declaresRevision(entityConstructor);

  /** The `expect` of a write, resolved to the column the store holds it in. */
  const conditionOf = (
    options: EntityWriteOptions | undefined,
  ): StoredStateCondition | undefined =>
    options?.expect === undefined
      ? undefined
      : storedStateCondition(entityConstructor, options.expect);

  /** The `AND state IN (…)` a condition adds to a write's `WHERE`. */
  const stateClause = (condition: StoredStateCondition | undefined) =>
    condition === undefined
      ? sql``
      : sql`AND ${sql(condition.key)} IN ${sql.in([...condition.in])}`;

  /** What a write that matched nothing reads back, only to name the refusal. */
  const readBack = (id: EntityId) =>
    sql<SqlRow>`
      SELECT * FROM ${table} WHERE ${sql('id')} = ${id} LIMIT 1
    `.pipe(Effect.mapError(error => translateSqlError(error)));

  /**
   * A save of an entity that declares a revision (ADR 0032): an insert that
   * never overwrites, or one `UPDATE … WHERE id = $1 AND revision = $2`. The
   * table needs a `revision integer NOT NULL` column — the host's migration,
   * since the adapter owns no DDL.
   */
  const saveRevised = <T extends Entity>(
    entity: T,
    condition: StoredStateCondition | undefined,
  ) =>
    Effect.gen(function* () {
      const key = extractMetaEntity(entityConstructor).key;
      const serialized = toSqlRow(
        serializeEntity(entityConstructor, entity as unknown as TEntity),
        json,
      );
      const read = readRevision(entity);
      const id = entity.id ?? randomUUID();
      if (read === undefined) {
        const row: SqlRow = { ...serialized, id, revision: 1 };
        const inserted = yield* sql<SqlRow>`
          INSERT INTO ${table} ${sql.insert(row)}
          ON CONFLICT (${sql('id')}) DO NOTHING
          RETURNING ${sql('id')}
        `.pipe(Effect.mapError(error => translateSqlError(error)));
        if (inserted.length === 0) {
          return yield* Effect.fail(new StaleRevision({ entity: key }));
        }
        entity.id = id;
        (entity as { revision?: number }).revision = 1;
        return entity;
      }
      const assignments = Object.entries(serialized)
        .filter(([column]) => column !== 'id' && column !== 'revision')
        .map(([column, value]) => sql`${sql(column)} = ${value as never}`);
      const updated = yield* sql<SqlRow>`
        UPDATE ${table}
        SET ${sql.csv([...assignments, sql`${sql('revision')} = ${sql('revision')} + 1`])}
        WHERE ${sql('id')} = ${id} AND ${sql('revision')} = ${read}
        ${stateClause(condition)}
        RETURNING ${sql('revision')}
      `.pipe(Effect.mapError(error => translateSqlError(error)));
      if (updated.length === 0) {
        // The write already decided; this read only names the refusal. A
        // record in another state is refused for its state before its
        // revision: a fresher read would not make the save legal.
        const stored = yield* readBack(id);
        if (stored[0] === undefined)
          return yield* new NotFound({ entity: key });
        if (
          condition !== undefined &&
          !holdsStoredState(condition, stored[0])
        ) {
          return yield* unavailableInState(
            entityConstructor,
            condition,
            stored[0],
          );
        }
        return yield* Effect.fail(
          new StaleRevision({
            entity: key,
            current: readRevision(stored[0]),
          }),
        );
      }
      entity.id = id;
      (entity as { revision?: number }).revision = read + 1;
      return entity;
    });

  const save = <T extends Entity>(entity: T, options?: EntityWriteOptions) => {
    const condition = conditionOf(options);
    if (revised) return saveRevised(entity, condition);
    return condition === undefined
      ? saveUnchecked(entity)
      : saveConditioned(entity, condition);
  };

  /**
   * An update of a record that declares no revision, on the states it must
   * hold: one `UPDATE … WHERE id = $1 AND state IN (…)`, never an insert — a
   * save with `expect` is an update of a stored record.
   */
  const saveConditioned = <T extends Entity>(
    entity: T,
    condition: StoredStateCondition,
  ) =>
    Effect.gen(function* () {
      const key = extractMetaEntity(entityConstructor).key;
      const id = entity.id;
      if (id === undefined) return yield* new NotFound({ entity: key });
      const serialized = toSqlRow(
        serializeEntity(entityConstructor, entity as unknown as TEntity),
        json,
      );
      const assignments = Object.entries(serialized)
        .filter(([column]) => column !== 'id')
        .map(([column, value]) => sql`${sql(column)} = ${value as never}`);
      // An entity whose only member is its id still has its state checked.
      const set =
        assignments.length === 0
          ? sql`${sql('id')} = ${sql('id')}`
          : sql.csv(assignments);
      const updated = yield* sql<SqlRow>`
        UPDATE ${table} SET ${set}
        WHERE ${sql('id')} = ${id} ${stateClause(condition)}
        RETURNING ${sql('id')}
      `.pipe(Effect.mapError(error => translateSqlError(error)));
      if (updated.length === 0) {
        const stored = yield* readBack(id);
        return yield* stored[0] === undefined
          ? Effect.fail(new NotFound({ entity: key }))
          : Effect.fail(
              unavailableInState(entityConstructor, condition, stored[0]),
            );
      }
      return entity;
    });

  const saveUnchecked = <T extends Entity>(entity: T) =>
    Effect.gen(function* () {
      const serialized = toSqlRow(
        serializeEntity(entityConstructor, entity as unknown as TEntity),
        json,
      );
      // A create arrives without an id, so the store mints one — the same
      // contract as the Mongo adapter, and what lets `save` double as the upsert
      // behind both POST and PUT.
      const id = entity.id ?? randomUUID();
      // The serializer drops `undefined`, so the resolved id is spread back in.
      const row: SqlRow = { ...serialized, id };

      const updatable = Object.keys(row).filter(column => column !== 'id');
      // An entity whose only member is its id has nothing to update; `DO UPDATE
      // SET` with an empty list is a syntax error, so it degrades to a no-op.
      const onConflict =
        updatable.length === 0
          ? sql.literal('DO NOTHING')
          : sql`DO UPDATE SET ${sql.csv(
              updatable.map(
                column => sql`${sql(column)} = EXCLUDED.${sql(column)}`,
              ),
            )}`;

      yield* sql`
        INSERT INTO ${table} ${sql.insert(row)}
        ON CONFLICT (${sql('id')}) ${onConflict}
      `.pipe(Effect.mapError(error => translateSqlError(error)));

      entity.id = id;
      return entity;
    });

  const del = <T extends Entity>(
    entityOrId: EntityId | T,
    options?: EntityWriteOptions,
  ) =>
    Effect.gen(function* () {
      const id = toEntityId(entityOrId);
      const condition = conditionOf(options);
      const deleted = yield* sql<SqlRow>`
        DELETE FROM ${table} WHERE ${sql('id')} = ${id} ${stateClause(condition)}
        RETURNING ${sql('id')}
      `.pipe(Effect.mapError(error => translateSqlError(error)));
      if (condition === undefined || deleted.length > 0) return;
      // Nothing deleted: either nothing was there, which a delete accepts,
      // or the record is in a state it may not be deleted from.
      const stored = yield* readBack(id);
      if (stored[0] !== undefined) {
        return yield* unavailableInState(
          entityConstructor,
          condition,
          stored[0],
        );
      }
    });

  // Cast through the interface to keep its generic signatures: each method here
  // is written against this entity's type, the interface against any entity's.
  return {
    load,
    get,
    save,
    delete: del,
  } as unknown as EntityRepository;
}
