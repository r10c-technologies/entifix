import { PgClient } from '@effect/sql-pg';
import { makeObservabilityLayer } from '@entifix/service-shell/observability';
import { SqlHealthProbeLayer } from '@entifix/sql';
import {
  AllowAllPolicyLayer,
  FixedTokenServiceLayer,
} from '@entifix/testing-auth';
import { Effect, Layer, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';

import type { MinimalServiceSettings } from './settings.ts';

export const SERVICE_NAME = 'example-minimal-service';

/**
 * The table the SQL adapter reads and writes: named for the entity's `key`, one
 * column per member. Idempotent, so it runs on every boot.
 */
const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS book (
      id text PRIMARY KEY,
      title text NOT NULL,
      author text NOT NULL,
      year integer,
      status text NOT NULL
    )
  `;
});

/**
 * Postgres, the migration, a readiness probe, and the auth stubs.
 *
 * ⚠️ `@entifix/testing-auth` trusts any bearer token. A real service provides
 * its own `TokenServiceTag` and `PolicyDecisionTag` here instead.
 */
export const makeAppLayer = (settings: MinimalServiceSettings) => {
  const database = PgClient.layer({ url: Redacted.make(settings.databaseUrl) });

  return Layer.mergeAll(
    makeObservabilityLayer({
      serviceName: SERVICE_NAME,
      level: 'info',
      sink: 'stdout',
    }),
    FixedTokenServiceLayer(),
    AllowAllPolicyLayer,
    Layer.provideMerge(
      Layer.mergeAll(
        SqlHealthProbeLayer(['book']),
        Layer.effectDiscard(migrate),
      ),
      database,
    ),
  ).pipe(Layer.orDie);
};
