import { NodeCrypto } from '@effect/platform-node';
import { PgClient } from '@effect/sql-pg';
import type { Slip } from '@entifix/business/flow';
import {
  ensureSqlTransactionTables,
  makeSqlOutbox,
} from '@entifix/sql/transactions';
import { flowEngineContractCatalog } from '@entifix/testing-unit/contracts';
import {
  type FlowEngine,
  FlowEngineTag,
  OutboxTag,
  ParticipantClientTag,
} from '@entifix/transactions';
import {
  InMemoryBulkheadLayer,
  InMemoryCircuitBreakerLayer,
  InMemoryRetryBudgetLayer,
} from '@entifix/transactions/engine';
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Redacted,
  Schedule,
} from 'effect';
import { SqlClient } from 'effect/sql';
import { afterAll, describe, expect, it } from 'vitest';

import {
  type JournalRetention,
  JournalRetentionUnset,
  purgeFinishedJournals,
} from './journal-retention.js';
import { SingleRunnerFlowEngineLayer } from './single-runner.js';

/*
 * The journal purge over a real Postgres, against the tables the cluster
 * workflow engine itself writes. The URL is required, so a run without one
 * fails rather than reporting green over nothing.
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

const freshDatabase = async (suffix: string) => {
  const name = `entifix_purge_${String(process.pid)}_${suffix}`;
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

const engineOver = async (
  suffix: string,
  retention: Partial<JournalRetention> = { journalRetention: '1 day' },
) => {
  const database = PgClient.layer({
    url: Redacted.make(await freshDatabase(suffix)),
  }) as Layer.Layer<SqlClient.SqlClient>;
  const outbox = Layer.effect(
    OutboxTag,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* ensureSqlTransactionTables(sql);
      return makeSqlOutbox(sql);
    }),
  );
  const runtime = ManagedRuntime.make(
    SingleRunnerFlowEngineLayer({
      catalog: flowEngineContractCatalog,
      source: 'integration',
      ...retention,
    } as Parameters<typeof SingleRunnerFlowEngineLayer>[0]).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          outbox,
          NodeCrypto.layer,
          InMemoryCircuitBreakerLayer({ dials: { minimumCalls: 100 } }),
          InMemoryBulkheadLayer(),
          InMemoryRetryBudgetLayer(),
          Layer.succeed(ParticipantClientTag, {
            call: () => Effect.succeed({ ok: true }),
          }),
        ).pipe(Layer.provideMerge(database)),
      ),
    ) as Layer.Layer<FlowEngineTag | SqlClient.SqlClient>,
  );
  runtimes.push(runtime as never);
  return runtime;
};

const step = (id: string) => ({
  ref: `contract.${id}@1`,
  step: id,
  cardinality: 'one' as const,
});

const slipOf = (flowId: string, steps: readonly string[]): Slip => ({
  slipVersion: 1,
  flowId,
  recipe: 'contract',
  stages: [{ name: 'main', steps: steps.map(step) }],
  resolution: [],
  composedAt: '2026-01-01T00:00:00.000Z',
});

const settled = (engine: FlowEngine, flowId: string) =>
  engine.status(flowId).pipe(
    Effect.repeat({
      until: status => status.state !== 'running',
      schedule: Schedule.spaced('20 millis'),
      times: 300,
    }),
  );

interface Journal {
  readonly messages: number;
  readonly replies: number;
  readonly correlation: string | null;
  readonly purged: boolean;
  readonly state: string;
}

const journalOf = (flowId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{
      readonly execution_id: string;
      readonly state: string;
      readonly correlation: string | null;
      readonly purged_at: Date | null;
    }>`SELECT execution_id, state, correlation, purged_at
       FROM entifix_flow_status WHERE flow_id = ${flowId}`;
    const execution = (row as { execution_id: string }).execution_id;
    const [messages] = yield* sql<{ readonly count: string }>`
      SELECT count(*) FROM cluster_messages WHERE entity_id = ${execution}`;
    const [replies] = yield* sql<{ readonly count: string }>`
      SELECT count(*) FROM cluster_replies WHERE request_id IN (
        SELECT id FROM cluster_messages WHERE entity_id = ${execution})`;
    return {
      messages: Number(messages?.count),
      replies: Number(replies?.count),
      correlation: row?.correlation ?? null,
      purged: row?.purged_at !== null,
      state: row?.state ?? '',
    } satisfies Journal;
  });

describe('the journal purge over Postgres', () => {
  it('empties an old finished flow’s journal and leaves every other flow whole, once', async () => {
    const runtime = await engineOver('purge');
    await runtime.runPromise(
      Effect.gen(function* () {
        const engine = yield* FlowEngineTag;
        const sql = yield* SqlClient.SqlClient;

        yield* engine.start(slipOf('old', ['hold', 'settle']), 'k-old');
        yield* engine.start(slipOf('recent', ['hold', 'settle']), 'k-recent');
        yield* engine.start(slipOf('waiting', ['hold', 'await']), 'k-wait');
        expect((yield* settled(engine, 'old')).state).toBe('completed');
        expect((yield* settled(engine, 'recent')).state).toBe('completed');
        expect((yield* settled(engine, 'waiting')).state).toBe('waiting');

        // The engine stamped when each flow ended; age one past retention.
        const [stamped] = yield* sql<{ readonly count: string }>`
          SELECT count(*) FROM entifix_flow_status
          WHERE terminal_at IS NOT NULL`;
        expect(Number(stamped?.count)).toBe(2);
        yield* sql`
          UPDATE entifix_flow_status
          SET terminal_at = now() - interval '2 days'
          WHERE flow_id = 'old'`;
        // A waiting flow aged the same way is still not purged.
        yield* sql`
          UPDATE entifix_flow_status
          SET terminal_at = now() - interval '2 days'
          WHERE flow_id = 'waiting'`;

        const before = {
          recent: yield* journalOf('recent'),
          waiting: yield* journalOf('waiting'),
        };
        expect((yield* journalOf('old')).messages).toBeGreaterThan(0);
        expect(before.waiting.messages).toBeGreaterThan(0);

        expect(yield* purgeFinishedJournals(sql, Duration.days(1))).toBe(1);

        expect(yield* journalOf('old')).toEqual({
          messages: 0,
          replies: 0,
          correlation: null,
          purged: true,
          state: 'completed',
        });
        // The others keep their journal: nothing of theirs was deleted (an
        // acknowledgement may still land), and their status rows are whole.
        const kept = (now: Journal, then: Journal) => {
          expect(now.purged).toBe(false);
          expect(now.state).toBe(then.state);
          expect(now.messages).toBeGreaterThanOrEqual(then.messages);
          expect(now.replies).toBeGreaterThanOrEqual(then.replies);
        };
        kept(yield* journalOf('recent'), before.recent);
        kept(yield* journalOf('waiting'), before.waiting);

        // A second pass finds nothing left to do, and changes nothing.
        expect(yield* purgeFinishedJournals(sql, Duration.days(1))).toBe(0);
        kept(yield* journalOf('recent'), before.recent);
        kept(yield* journalOf('waiting'), before.waiting);

        // The purged flow still answers its status, and a repeated start of
        // it runs nothing again.
        expect(yield* engine.status('old')).toMatchObject({
          flowId: 'old',
          state: 'completed',
        });
        yield* engine.start(slipOf('old', ['hold', 'settle']), 'k-old');
        expect((yield* journalOf('old')).messages).toBe(0);
      }),
    );
  });

  it('refuses to start the engine without a retention, naming the dial', async () => {
    const runtime = await engineOver('unset', {});

    const exit = await runtime.runPromiseExit(
      Effect.service(FlowEngineTag) as Effect.Effect<unknown>,
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const failure = Exit.isFailure(exit)
      ? Cause.findErrorOption(exit.cause)
      : undefined;
    expect(failure?._tag === 'Some' && failure.value).toBeInstanceOf(
      JournalRetentionUnset,
    );
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(
      'needs journalRetention',
    );
  });
});
