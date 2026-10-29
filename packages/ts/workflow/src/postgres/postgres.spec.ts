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

    expect(fake.executions.map(({ params }) => params)).toEqual([
      ['waiting', 'await', 'await', 'flow-1'],
      ['completed', null, null, 'flow-1'],
    ]);
  });

  it('translates a store failure', async () => {
    const { fake, sql } = fresh();
    const store = makeSqlFlowStatusStore(sql);
    fake.failWith('down');

    for (const operation of [
      ensureFlowStatusTable(sql),
      store.register('k', { flowId: 'f', executionId: 'e', state: 'running' }),
      store.find('f'),
      store.update('f', { state: 'completed' }),
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
  });
});

describe('the durable engine layers', () => {
  it('compose for one runner and for one of several', () => {
    expect(
      Layer.isLayer(SingleRunnerFlowEngineLayer(flowEngineContractCatalog)),
    ).toBe(true);
    expect(
      Layer.isLayer(
        SocketRunnerFlowEngineLayer(flowEngineContractCatalog, {
          host: 'localhost',
          port: 34103,
        }),
      ),
    ).toBe(true);
  });
});
