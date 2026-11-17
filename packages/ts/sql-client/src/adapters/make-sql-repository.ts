import { randomUUID } from 'node:crypto';

import type { EntityRepository } from '@entifix/business';
import {
  declaresRevision,
  deserializeEntityCollection,
  deserializeSingleEntity,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityLoadRequest,
  type EntityPage,
  extractMetaEntity,
  InvalidQuery,
  NotFound,
  readRevision,
  serializeEntity,
  StaleRevision,
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
 * **v1 handles flat scalar entities.** Embedded links and `linkCollection`
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

  /**
   * A save of an entity that declares a revision (ADR 0032): an insert that
   * never overwrites, or one `UPDATE … WHERE id = $1 AND revision = $2`. The
   * table needs a `revision integer NOT NULL` column — the host's migration,
   * since the adapter owns no DDL.
   */
  const saveRevised = <T extends Entity>(entity: T) =>
    Effect.gen(function* () {
      const key = extractMetaEntity(entityConstructor).key;
      const serialized = serializeEntity(
        entityConstructor,
        entity as unknown as TEntity,
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
        RETURNING ${sql('revision')}
      `.pipe(Effect.mapError(error => translateSqlError(error)));
      if (updated.length === 0) {
        // The write already decided; this read only names the refusal.
        const stored = yield* sql<SqlRow>`
          SELECT ${sql('revision')} FROM ${table} WHERE ${sql('id')} = ${id} LIMIT 1
        `.pipe(Effect.mapError(error => translateSqlError(error)));
        return yield* stored.length === 0
          ? Effect.fail(new NotFound({ entity: key }))
          : Effect.fail(
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

  const save = <T extends Entity>(entity: T) =>
    revised ? saveRevised(entity) : saveUnchecked(entity);

  const saveUnchecked = <T extends Entity>(entity: T) =>
    Effect.gen(function* () {
      const serialized = serializeEntity(
        entityConstructor,
        entity as unknown as TEntity,
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

  const del = <T extends Entity>(entityOrId: EntityId | T) =>
    Effect.gen(function* () {
      const id = toEntityId(entityOrId);
      yield* sql`DELETE FROM ${table} WHERE ${sql('id')} = ${id}`.pipe(
        Effect.mapError(error => translateSqlError(error)),
      );
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
