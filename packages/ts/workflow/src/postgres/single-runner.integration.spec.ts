import { NodeCrypto } from '@effect/platform-node';
import { PgClient } from '@effect/sql-pg';
import type { FragmentCatalog } from '@entifix/business/flow';
import {
  ensureSqlTransactionTables,
  makeSqlOutbox,
} from '@entifix/sql/transactions';
import type { FakeParticipant } from '@entifix/testing-unit';
import { describeFlowEngineContract } from '@entifix/testing-unit/contracts';
import {
  FlowEngineTag,
  OutboxTag,
  ParticipantClientTag,
} from '@entifix/transactions';
import {
  InMemoryBulkheadLayer,
  InMemoryCircuitBreakerLayer,
  InMemoryRetryBudgetLayer,
} from '@entifix/transactions/engine';
import { Effect, Layer, ManagedRuntime, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterAll } from 'vitest';

import { SingleRunnerFlowEngineLayer } from './single-runner.js';

/*
 * The cluster workflow engine over a real Postgres. The URL is required, so a
 * run without one fails rather than reporting green over nothing.
 */
const url = process.env['ENTIFIX_PG_URL'];
if (url === undefined || url === '')
  throw new Error(
    'ENTIFIX_PG_URL is not set: the workflow suites run against a real Postgres',
  );

const runtimes: ManagedRuntime.ManagedRuntime<unknown, unknown>[] = [];
afterAll(async () => {
  for (const runtime of runtimes) await runtime.dispose();
});

let databases = 0;

/** A database of its own per case: the journal of one case is not the next's. */
const freshDatabase = async () => {
  databases += 1;
  const name = `entifix_wf_${String(process.pid)}_${String(databases)}`;
  const admin = ManagedRuntime.make(
    PgClient.layer({
      url: Redacted.make(url),
    }) as Layer.Layer<SqlClient.SqlClient>,
  );
  await admin.runPromise(
    Effect.flatMap(SqlClient.SqlClient, sql =>
      Effect.andThen(
        sql.unsafe(`DROP DATABASE IF EXISTS ${name}`),
        sql.unsafe(`CREATE DATABASE ${name}`),
      ),
    ),
  );
  await admin.dispose();
  const target = new URL(url);
  target.pathname = `/${name}`;
  return target.toString();
};

describeFlowEngineContract(
  'the cluster engine on one runner over Postgres',
  async (catalog: FragmentCatalog, participant: FakeParticipant) => {
    const database = PgClient.layer({
      url: Redacted.make(await freshDatabase()),
    }) as Layer.Layer<SqlClient.SqlClient>;
    // Its announcements land in the outbox beside the journal, as a host's do.
    const outbox = Layer.effect(
      OutboxTag,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* ensureSqlTransactionTables(sql);
        return makeSqlOutbox(sql);
      }),
    );
    const runtime = ManagedRuntime.make(
      SingleRunnerFlowEngineLayer({ catalog, source: 'integration' }).pipe(
        Layer.provide(
          Layer.mergeAll(
            outbox,
            NodeCrypto.layer,
            InMemoryCircuitBreakerLayer({ dials: { minimumCalls: 100 } }),
            InMemoryBulkheadLayer(),
            InMemoryRetryBudgetLayer(),
            Layer.succeed(ParticipantClientTag, {
              call: ({ step, kind }) =>
                kind === 'action' ? participant(step) : Effect.void,
            }),
          ).pipe(Layer.provideMerge(database)),
        ),
      ) as Layer.Layer<FlowEngineTag>,
    );
    runtimes.push(runtime as never);
    return runtime.runPromise(Effect.service(FlowEngineTag));
  },
);
