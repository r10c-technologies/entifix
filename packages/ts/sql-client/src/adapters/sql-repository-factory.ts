import { EntityRepositoryFactoryTag } from '@entifix/business';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';

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
