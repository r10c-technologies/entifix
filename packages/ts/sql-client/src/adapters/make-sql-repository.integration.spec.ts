import { PgClient } from '@effect/sql-pg';
import { serializeEntity } from '@entifix/core';
import {
  describeEntityRepositoryRevisionContract,
  RevisedWidget,
} from '@entifix/testing-unit/contracts';
import { Effect, Layer, ManagedRuntime, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterAll } from 'vitest';

import { makeSqlRepository } from './make-sql-repository.js';

/*
 * The revision contract against a real Postgres: the race it asserts — two
 * saves at one revision leave exactly one winner — is one conditional
 * statement's property, and a fake that executes no SQL cannot show it.
 */
const url = process.env['ENTIFIX_PG_URL'];
if (url === undefined || url === '')
  throw new Error(
    'ENTIFIX_PG_URL is not set: the SQL contract suites run against a real Postgres',
  );

const runtime = ManagedRuntime.make(
  PgClient.layer({
    url: Redacted.make(url),
  }) as Layer.Layer<SqlClient.SqlClient>,
);
afterAll(() => runtime.dispose());

const makeRepository = async (seed: RevisedWidget[]) => {
  const sql = await runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      // The host's migration: a declared entity's table carries the column.
      yield* client`
        CREATE TABLE IF NOT EXISTS "revised-widget" (
          id text PRIMARY KEY,
          name text,
          revision integer NOT NULL
        )`;
      yield* client`TRUNCATE "revised-widget"`;
      for (const widget of seed) {
        yield* client`
          INSERT INTO "revised-widget" ${client.insert(
            serializeEntity(RevisedWidget, widget),
          )}`;
      }
      return client;
    }),
  );
  // Run every statement through the runtime, so each is its own connection use.
  return makeSqlRepository(sql, RevisedWidget);
};

describeEntityRepositoryRevisionContract('Postgres', { makeRepository });
