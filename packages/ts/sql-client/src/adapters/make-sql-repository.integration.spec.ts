import { PgClient } from '@effect/sql-pg';
import { defineLocales, serializeEntity } from '@entifix/core';
import {
  ContractWidget,
  describeEntityFacetCounterContract,
  describeEntityRepositoryContract,
  describeEntityRepositoryRevisionContract,
  describeEntityRepositoryStateContract,
  RevisedWidget,
  StatedWidget,
} from '@entifix/testing-unit/contracts';
import { Effect, Layer, ManagedRuntime, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterAll, beforeAll } from 'vitest';

import { makeSqlFacetCounter } from './make-sql-facet-counter.js';
import {
  jsonColumns,
  makeSqlRepository,
  toSqlRow,
} from './make-sql-repository.js';

/*
 * The contracts against a real Postgres. The revision race — two saves at one
 * revision leave exactly one winner — is one conditional statement's property,
 * and a list filtered or counted per element is `jsonb` semantics: a fake that
 * executes no SQL can show neither.
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
// The host's locales: a `localized` member is filtered and sorted one declared
// locale at a time, and the SQL translator refuses any other.
beforeAll(() => defineLocales({ locales: ['en', 'es'], defaultLocale: 'en' }));

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

// The state condition is one statement's `AND stage IN (…)`, and the race a
// release runs against a conditioned delete is decided by Postgres, not here.
describeEntityRepositoryStateContract('Postgres', {
  makeRepository: async seed => {
    const sql = await runtime.runPromise(
      Effect.gen(function* () {
        const client = yield* SqlClient.SqlClient;
        yield* client`
          CREATE TABLE IF NOT EXISTS "stated-widget" (
            id text PRIMARY KEY,
            name text,
            stage text
          )`;
        yield* client`TRUNCATE "stated-widget"`;
        for (const widget of seed) {
          yield* client`
            INSERT INTO "stated-widget" ${client.insert(
              serializeEntity(StatedWidget, widget),
            )}`;
        }
        return client;
      }),
    );
    return makeSqlRepository(sql, StatedWidget);
  },
});

/**
 * The contract widget's table, as a host's migration writes it: a list as one
 * `jsonb` array and a text per locale as another, seeded through the same row
 * shape the repository writes.
 */
const seedWidgets = (seed: ContractWidget[]) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      yield* client`
        CREATE TABLE IF NOT EXISTS "contract-widget" (
          id text PRIMARY KEY,
          name text,
          size integer,
          tags jsonb,
          title jsonb
        )`;
      yield* client`TRUNCATE "contract-widget"`;
      const json = jsonColumns(ContractWidget);
      for (const widget of seed) {
        yield* client`INSERT INTO "contract-widget" ${client.insert(
          toSqlRow(serializeEntity(ContractWidget, widget), json),
        )}`;
      }
      return client;
    }),
  );

describeEntityRepositoryContract('Postgres', {
  makeRepository: async seed =>
    makeSqlRepository(await seedWidgets(seed), ContractWidget),
});

describeEntityFacetCounterContract('Postgres', {
  makeCounter: async seed =>
    makeSqlFacetCounter(await seedWidgets(seed), ContractWidget),
});
