import { Unavailable } from '@entifix/core';
import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import { Duration, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import {
  isTerminalFlowState,
  TERMINAL_FLOW_STATES,
} from '../status/flow-status-store.js';
import {
  JOURNAL_PURGE_BATCH,
  JOURNAL_PURGE_INTERVAL,
  JournalPurgeLayer,
  type JournalPurgeOutcome,
  type JournalRetention,
  JournalRetentionUnset,
  purgeFinishedJournals,
} from './journal-retention.js';

const fresh = () => {
  const fake = makeFakeSqlClient();
  return { fake, sql: fake.client as SqlClient.SqlClient };
};

const flows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ flow_id: `f-${index}` }));

describe('the terminal flow states', () => {
  it('are the states nothing resumes a flow from', () => {
    expect(TERMINAL_FLOW_STATES).toEqual([
      'completed',
      'compensated',
      'failed',
      'interrupted',
      'stranded',
    ]);
    expect(isTerminalFlowState('stranded')).toBe(true);
    for (const state of ['running', 'waiting', 'suspended'] as const)
      expect(isTerminalFlowState(state)).toBe(false);
  });
});

describe('purgeFinishedJournals', () => {
  it('empties the journal of ended flows past retention, in one statement', async () => {
    const { fake, sql } = fresh();
    fake.respondTo('WITH due AS', flows(2));

    expect(
      await Effect.runPromise(
        purgeFinishedJournals(sql, Duration.days(30), 50),
      ),
    ).toBe(2);

    const [purge] = fake.executions;
    expect(purge?.sql).toContain(
      "state IN ('completed', 'compensated', 'failed', 'interrupted', 'stranded')",
    );
    expect(purge?.sql).toContain('purged_at IS NULL');
    expect(purge?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(purge?.sql).toContain('DELETE FROM cluster_replies');
    expect(purge?.sql).toContain('DELETE FROM cluster_messages');
    expect(purge?.sql).toContain(
      'SET correlation = NULL, accepts = NULL, purged_at = now()',
    );
    expect(purge?.params).toEqual([30 * 24 * 60 * 60, 50]);
  });

  it('purges a default batch', async () => {
    const { fake, sql } = fresh();

    await Effect.runPromise(purgeFinishedJournals(sql, Duration.days(1)));

    expect(fake.executions[0]?.params).toEqual([
      24 * 60 * 60,
      JOURNAL_PURGE_BATCH,
    ]);
  });

  it('translates a store failure', async () => {
    const { fake, sql } = fresh();
    fake.failWith('down');

    expect(
      await Effect.runPromise(
        Effect.flip(purgeFinishedJournals(sql, Duration.days(1))),
      ),
    ).toBeInstanceOf(Unavailable);
  });
});

/** Builds the purge layer over a fake client under the test clock. */
const purgeLayer = (options: JournalRetention, sql: SqlClient.SqlClient) =>
  JournalPurgeLayer(options).pipe(
    Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
  );

describe('JournalPurgeLayer', () => {
  it.each([
    ['missing', undefined, /needs journalRetention/],
    ['zero', 0, /journalRetention 0 is not a positive duration/],
    ['unreadable', 'soon', /journalRetention soon is not a positive duration/],
  ])(
    'refuses to build when the retention is %s, naming the dial',
    async (_case, journalRetention, reason) => {
      const { fake, sql } = fresh();
      const failure = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Layer.build(
              purgeLayer(
                { journalRetention } as unknown as JournalRetention,
                sql,
              ),
            ),
          ),
        ),
      );

      expect(failure).toBeInstanceOf(JournalRetentionUnset);
      expect(failure).toMatchObject({ dial: 'journalRetention' });
      expect((failure as JournalRetentionUnset).reason).toMatch(reason);
      expect((failure as JournalRetentionUnset).message).toMatch(reason);
      expect(fake.executions).toHaveLength(0);
    },
  );

  it('purges once an interval has passed, then every interval, and reports each pass', async () => {
    const { fake, sql } = fresh();
    const outcomes: JournalPurgeOutcome[] = [];
    fake.respondTo('WITH due AS', flows(2));

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            purgeLayer(
              {
                journalRetention: '7 days',
                purgeInterval: '10 minutes',
                purgeBatch: 3,
                onPurge: outcome =>
                  Effect.sync(() => {
                    outcomes.push(outcome);
                  }),
              },
              sql,
            ),
          );
          // Nothing at once: the engine has not yet made the tables the
          // purge reads.
          yield* TestClock.adjust('9 minutes');
          expect(fake.executions).toHaveLength(0);

          yield* TestClock.adjust('1 minute');
          expect(outcomes).toEqual([{ _tag: 'purged', flows: 2 }]);
          expect(fake.executions[0]?.params).toEqual([7 * 24 * 60 * 60, 3]);

          // A failed pass is reported, and the next one still runs.
          fake.failOn('WITH due AS', 'down');
          yield* TestClock.adjust('10 minutes');
          expect(outcomes[1]).toMatchObject({ _tag: 'purgeFailed' });
          yield* TestClock.adjust('10 minutes');
          expect(outcomes).toHaveLength(3);
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    );
  });

  it('keeps purging a pass until a batch comes back short', async () => {
    const { fake, sql } = fresh();
    // Two full batches of two, then a short one of one: the count is read
    // when the statement answers, from how many have run.
    const answers = [2, 2, 1];
    fake.respondTo(
      'WITH due AS',
      new Proxy([] as Array<{ flow_id: string }>, {
        get: (target, property, receiver) =>
          property === 'length'
            ? (answers[fake.executions.length - 1] ?? 0)
            : Reflect.get(target, property, receiver),
      }),
    );
    const outcomes: JournalPurgeOutcome[] = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            purgeLayer(
              {
                journalRetention: Duration.days(1),
                purgeBatch: 2,
                onPurge: outcome =>
                  Effect.sync(() => {
                    outcomes.push(outcome);
                  }),
              },
              sql,
            ),
          );
          yield* TestClock.adjust(JOURNAL_PURGE_INTERVAL);
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    );

    expect(fake.executions).toHaveLength(3);
    expect(outcomes).toEqual([{ _tag: 'purged', flows: 5 }]);
  });

  it('falls back to the default interval and batch for unusable ones', async () => {
    const { fake, sql } = fresh();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            purgeLayer(
              {
                journalRetention: '1 day',
                purgeInterval: 0,
                purgeBatch: 0,
              },
              sql,
            ),
          );
          yield* TestClock.adjust(JOURNAL_PURGE_INTERVAL);
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    );

    expect(fake.executions[0]?.params).toEqual([
      24 * 60 * 60,
      JOURNAL_PURGE_BATCH,
    ]);
  });
});
