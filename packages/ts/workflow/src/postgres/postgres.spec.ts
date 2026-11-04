import { Unavailable } from '@entifix/core';
import { flowEngineContractCatalog } from '@entifix/testing-unit/contracts';
import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import { Effect, Layer, Option } from 'effect';
import { SqlClient } from 'effect/sql';
import { describe, expect, it } from 'vitest';

import { SocketRunnerFlowEngineLayer } from '../socket-runner/socket-runner.js';
import { FlowStatusStoreTag } from '../status/flow-status-store.js';
import { SingleRunnerFlowEngineLayer } from './single-runner.js';
import {
  ensureFlowStatusTable,
  makeSqlFlowStatusStore,
  SqlFlowStatusStoreLayer,
} from './sql-flow-status-store.js';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const fresh = () => {
  const fake = makeFakeSqlClient();
  return { fake, sql: fake.client as SqlClient.SqlClient };
};

const row = {
  flow_id: 'flow-1',
  execution_id: 'exec-1',
  state: 'waiting',
  step: 'await',
  waiting_for: 'await',
  correlation: null,
  accepts: null,
};

describe('the SQL flow status store', () => {
  it('registers a flow under its key, or answers the one already there', async () => {
    const { fake, sql } = fresh();
    const store = makeSqlFlowStatusStore(sql);
    const record = {
      flowId: 'flow-1',
      executionId: 'exec-1',
      state: 'running' as const,
    };

    fake.respondTo('INSERT INTO entifix_flow_status', [
      { ...row, state: 'running', step: null, waiting_for: null },
    ]);
    expect(await run(store.register('k', record))).toEqual(record);

    fake.respondTo('INSERT INTO entifix_flow_status', []);
    fake.respondTo('SELECT * FROM entifix_flow_status', [row]);
    expect(await run(store.register('k', record))).toEqual({
      flowId: 'flow-1',
      executionId: 'exec-1',
      state: 'waiting',
      step: 'await',
      waitingFor: 'await',
    });
  });

  it('finds a flow by what its wait is correlated with', async () => {
    const { fake, sql } = fresh();
    const store = makeSqlFlowStatusStore(sql);

    fake.respondTo('WHERE correlation', [
      { ...row, correlation: 'order-7', accepts: '["delivered","refused"]' },
    ]);
    expect(await run(store.findByCorrelation('order-7'))).toEqual(
      Option.some({
        flowId: 'flow-1',
        executionId: 'exec-1',
        state: 'waiting',
        step: 'await',
        waitingFor: 'await',
        correlation: 'order-7',
        accepts: ['delivered', 'refused'],
      }),
    );
    // A column written by something other than this store reads as no
    // outcomes at all, never as a crash.
    fake.respondTo('WHERE correlation', [{ ...row, accepts: '{}' }]);
    expect(await run(store.findByCorrelation('order-7'))).toEqual(
      Option.some(expect.objectContaining({ accepts: [] })),
    );
    fake.respondTo('WHERE correlation', []);
    expect(Option.isNone(await run(store.findByCorrelation('order-8')))).toBe(
      true,
    );
  });

  it('finds a flow, or none', async () => {
    const { fake, sql } = fresh();
    const store = makeSqlFlowStatusStore(sql);

    fake.respondTo('SELECT * FROM entifix_flow_status', [row]);
    expect(Option.isSome(await run(store.find('flow-1')))).toBe(true);
    fake.respondTo('SELECT * FROM entifix_flow_status', []);
    expect(Option.isNone(await run(store.find('flow-2')))).toBe(true);
  });

  it('updates a flow’s state and clears what the patch leaves out', async () => {
    const { fake, sql } = fresh();
    const store = makeSqlFlowStatusStore(sql);

    await run(
      store.update('flow-1', {
        state: 'waiting',
        step: 'await',
        waitingFor: 'await',
      }),
    );
    await run(store.update('flow-1', { state: 'completed' }));

    await run(
      store.update('flow-1', {
        state: 'waiting',
        step: 'await',
        waitingFor: 'await',
        correlation: 'order-7',
        accepts: ['delivered'],
      }),
    );

    expect(fake.executions.map(({ params }) => params)).toEqual([
      ['waiting', 'await', 'await', null, null, 'flow-1'],
      ['completed', null, null, null, null, 'flow-1'],
      ['waiting', 'await', 'await', 'order-7', '["delivered"]', 'flow-1'],
    ]);
  });

  it('claims a wait with one conditional update, and answers whether it held', async () => {
    const { fake, sql } = fresh();
    const store = makeSqlFlowStatusStore(sql);
    fake.respondTo('UPDATE entifix_flow_status', [{ flow_id: 'flow-1' }]);

    expect(await run(store.claimWait('flow-1', 'await'))).toBe(true);
    fake.respondTo('UPDATE entifix_flow_status', []);
    expect(await run(store.claimWait('flow-1', 'await'))).toBe(false);

    const [claim] = fake.executions;
    expect(claim?.sql).toContain("state = 'waiting' AND waiting_for =");
    expect(claim?.params).toEqual(['await', 'flow-1', 'await']);
  });

  it('translates a store failure', async () => {
    const { fake, sql } = fresh();
    const store = makeSqlFlowStatusStore(sql);
    fake.failWith('down');

    for (const operation of [
      ensureFlowStatusTable(sql),
      store.register('k', { flowId: 'f', executionId: 'e', state: 'running' }),
      store.find('f'),
      store.findByCorrelation('c'),
      store.update('f', { state: 'completed' }),
      store.claimWait('f', 'await'),
    ] as Effect.Effect<unknown, unknown>[])
      expect(await run(Effect.flip(operation))).toBeInstanceOf(Unavailable);
  });

  it('ensures its table as its layer builds', async () => {
    const { fake, sql } = fresh();

    await run(
      Effect.service(FlowStatusStoreTag).pipe(
        Effect.provide(SqlFlowStatusStoreLayer),
        Effect.provide(Layer.succeed(SqlClient.SqlClient, sql)),
      ),
    );

    expect(fake.executions[0]?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS entifix_flow_status',
    );
    // A table an earlier release created gains the column it lacks.
    expect(fake.executions[1]?.sql).toContain(
      'ADD COLUMN IF NOT EXISTS accepts',
    );
  });
});

describe('the durable engine layers', () => {
  it('compose for one runner and for one of several', () => {
    expect(
      Layer.isLayer(
        SingleRunnerFlowEngineLayer({
          catalog: flowEngineContractCatalog,
          source: 'spec',
        }),
      ),
    ).toBe(true);
    expect(
      Layer.isLayer(
        SocketRunnerFlowEngineLayer(
          { catalog: flowEngineContractCatalog, source: 'spec' },
          {
            host: 'localhost',
            port: 34103,
          },
        ),
      ),
    ).toBe(true);
  });
});
