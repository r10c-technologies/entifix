// One runner of the chaos suite, as a process of its own so it can be killed.
// Plain Node over the built packages — what a host runs — with a participant
// that records every call in Postgres and misbehaves on cue, and a control
// port the suite starts and signals flows through.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { NodeCrypto } from '@effect/platform-node';
import { PgClient } from '@effect/sql-pg';
import { defineCatalog, defineFragment } from '@entifix/business/flow';
import {
  ensureSqlTransactionTables,
  makeSqlOutbox,
} from '@entifix/sql/transactions';
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
import { SocketRunnerFlowEngineLayer } from '@entifix/workflow/socket-runner';
import { Effect, Layer, ManagedRuntime, Redacted, Schema } from 'effect';
import { SqlClient } from 'effect/sql';

const env = name => {
  const value = process.env[name];
  if (value === undefined || value === '')
    throw new Error(`${name} is not set`);
  return value;
};

const PG_URL = env('CHAOS_PG_URL');
const RUNNER = env('CHAOS_RUNNER');
const RUNNER_PORT = Number(env('CHAOS_RUNNER_PORT'));
const CONTROL_PORT = Number(env('CHAOS_CONTROL_PORT'));
// The planted violation: a participant key that changes per delivery, which
// the double-delivery case must catch.
const BREAK_KEY = process.env['CHAOS_BREAK_KEY'] === '1';

const contract = {
  input: Schema.Unknown,
  output: Schema.Unknown,
  failure: Schema.Unknown,
};
const fragment = (id, kind) =>
  defineFragment({
    id: `chaos.${id}`,
    version: 1,
    module: 'chaos',
    kind,
    participant: 'chaos',
    call: { method: 'POST', path: `/api/${id}` },
    ...(kind === 'compensatable'
      ? { compensation: { method: 'DELETE', path: `/api/${id}/:id` } }
      : {}),
    cardinality: 'one',
    contract,
  });

const catalog = defineCatalog([
  fragment('hold', 'compensatable'),
  fragment('take', 'pivot'),
  fragment('settle', 'retriable'),
  fragment('await', 'wait'),
]);

/** Takes `flag` once across every runner; answers whether this call took it. */
const takeFlag = (sql, flag) =>
  Effect.map(
    sql`INSERT INTO chaos_flags (flag) VALUES (${flag}) ON CONFLICT DO NOTHING RETURNING flag`,
    rows => rows.length > 0,
  );

const participant = sql => ({
  call: ({ step, kind, idempotencyKey }) =>
    Effect.gen(function* () {
      const flowId = idempotencyKey.slice(0, idempotencyKey.indexOf(':'));
      const key = BREAK_KEY
        ? `${idempotencyKey}:${randomUUID()}`
        : idempotencyKey;
      const chaos = kind === 'action' ? step.parameters?.['chaos'] : undefined;
      yield* sql`
        INSERT INTO chaos_calls (flow_id, step, kind, key, runner)
        VALUES (${flowId}, ${step.step}, ${kind}, ${key}, ${RUNNER})`;
      // Hangs the first delivery, so the suite can kill whoever holds it.
      if (
        chaos === 'block-first' &&
        (yield* takeFlag(sql, `block:${idempotencyKey}`))
      )
        return yield* Effect.never;
      // The participant's own dedup: one effect per key, however often called.
      yield* sql`
        INSERT INTO chaos_effects (key, flow_id, step, kind, runner)
        VALUES (${key}, ${flowId}, ${step.step}, ${kind}, ${RUNNER})
        ON CONFLICT (key) DO NOTHING`;
      // Applied, then gone before the answer is journaled: the next runner
      // delivers the same call again.
      if (
        chaos === 'die-after-apply' &&
        (yield* takeFlag(sql, `die:${idempotencyKey}`))
      ) {
        process.kill(process.pid, 'SIGKILL');
        return yield* Effect.never;
      }
      return { id: `${step.step}-1` };
    }).pipe(Effect.orDie),
});

const database = PgClient.layer({ url: Redacted.make(PG_URL) });

const services = Layer.mergeAll(
  NodeCrypto.layer,
  InMemoryCircuitBreakerLayer({ dials: { minimumCalls: 1000 } }),
  InMemoryBulkheadLayer(),
  InMemoryRetryBudgetLayer(),
  Layer.effect(
    OutboxTag,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* ensureSqlTransactionTables(sql);
      return makeSqlOutbox(sql);
    }),
  ),
  Layer.effect(
    ParticipantClientTag,
    Effect.map(SqlClient.SqlClient, participant),
  ),
).pipe(Layer.provideMerge(database));

const runtime = ManagedRuntime.make(
  SocketRunnerFlowEngineLayer(
    {
      catalog,
      source: 'chaos',
      // A blocked call is ended by killing its runner, never by a bound.
      dials: { attemptTimeoutMs: 600_000, stepTimeoutMs: 600_000 },
    },
    {
      host: 'localhost',
      port: RUNNER_PORT,
      sharding: {
        shardsPerGroup: 30,
        shardLockRefreshInterval: '300 millis',
        shardLockExpiration: '2 seconds',
        refreshAssignmentsInterval: '300 millis',
        entityMessagePollInterval: '300 millis',
        entityReplyPollInterval: '100 millis',
        runnerHealthCheckInterval: '500 millis',
        entityMaxIdleTime: '1 second',
        sendRetryInterval: '100 millis',
      },
    },
  ).pipe(Layer.provide(services)),
);

const engine = await runtime.runPromise(Effect.service(FlowEngineTag));

const answer = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const routes = {
  '/start': ({ slip, key }) => engine.start(slip, key),
  '/signal': ({ flowId, token, outcome }) =>
    Effect.as(engine.signal(flowId, token, outcome), { signalled: true }),
};

createServer((request, response) => {
  let body = '';
  request.on('data', chunk => (body += chunk));
  request.on('end', () => {
    const route = routes[request.url ?? ''];
    if (route === undefined) return answer(response, 404, {});
    runtime
      .runPromise(Effect.result(route(JSON.parse(body))))
      .then(result =>
        result._tag === 'Success'
          ? answer(response, 200, result.success)
          : answer(response, 409, { tag: result.failure._tag }),
      )
      .catch(error => answer(response, 500, { error: String(error) }));
  });
}).listen(CONTROL_PORT, () => console.log('ready'));
