import {
  EntityFacetCounterFactoryTag,
  EntityRepositoryFactoryTag,
} from '@entifix/business';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';

import { makeSqlFacetCounter } from './make-sql-facet-counter.js';
import { makeSqlRepository } from './make-sql-repository.js';

/**
 * The repository factory over the one SQL database the service connects to:
 * every entity reads and writes its own table on the `SqlClient` the
 * composition root provides. A route set asks the factory, never the client,
 * so it names no engine.
 */
export const SqlRepositoryFactoryLayer = Layer.effect(
  EntityRepositoryFactoryTag,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      for: entityConstructor =>
        Effect.succeed(makeSqlRepository(sql, entityConstructor)),
    };
  }),
);

/**
 * Facet counters over the same database — `SqlRepositoryFactoryLayer`'s
 * counterpart, bound beside it so a service's `$facets` and its pages read one
 * store.
 */
export const SqlFacetCounterFactoryLayer = Layer.effect(
  EntityFacetCounterFactoryTag,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      for: entityConstructor =>
        Effect.succeed(makeSqlFacetCounter(sql, entityConstructor)),
    };
  }),
);
