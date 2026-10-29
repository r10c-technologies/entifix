import type { FragmentCatalog, Slip } from '@entifix/business/flow';
import { Unavailable } from '@entifix/core';
import type { FakeParticipant } from '@entifix/testing-unit';
import {
  describeFlowEngineContract,
  flowEngineContractCatalog,
} from '@entifix/testing-unit/contracts';
import {
  type FlowEngine,
  FlowEngineTag,
  ParticipantClientTag,
} from '@entifix/transactions';
import { Effect, Layer, ManagedRuntime, Option } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { afterAll, describe, expect, it } from 'vitest';

import {
  FlowStatusStoreTag,
  makeInMemoryFlowStatusStore,
} from '../status/flow-status-store.js';
import { FlowEngineLayer } from './make-flow-engine.js';

const runtimes: ManagedRuntime.ManagedRuntime<FlowEngineTag, never>[] = [];
afterAll(async () => {
  for (const runtime of runtimes) await runtime.dispose();
});

/** The engine over the in-memory workflow engine, a fresh one per case. */
export const inMemoryEngine = async (
  catalog: FragmentCatalog,
  participant: FakeParticipant,
) => {
  const runtime = ManagedRuntime.make(
    FlowEngineLayer(catalog).pipe(
      Layer.provide(
        Layer.mergeAll(
          WorkflowEngine.layerMemory,
          Layer.succeed(FlowStatusStoreTag, makeInMemoryFlowStatusStore()),
          Layer.succeed(ParticipantClientTag, {
            call: ({ step, kind }) =>
              kind === 'action' ? participant(step) : Effect.void,
          }),
        ),
      ),
    ) as Layer.Layer<FlowEngineTag>,
  );
  runtimes.push(runtime);
  return runtime.runPromise(Effect.service(FlowEngineTag));
};

describeFlowEngineContract('the in-memory workflow engine', inMemoryEngine);

describe('the slip interpreter', () => {
  const engineWith = async (
    call: (step: string, kind: string) => Effect.Effect<unknown, Unavailable>,
  ) => {
    const store = makeInMemoryFlowStatusStore();
    const runtime = ManagedRuntime.make(
      FlowEngineLayer(flowEngineContractCatalog).pipe(
        Layer.provide(
          Layer.mergeAll(
            WorkflowEngine.layerMemory,
            Layer.succeed(FlowStatusStoreTag, store),
            Layer.succeed(ParticipantClientTag, {
              call: ({ step, kind }) => call(step.step, kind),
            }),
          ),
        ),
      ) as Layer.Layer<FlowEngineTag>,
    );
    runtimes.push(runtime);
    return {
      engine: await runtime.runPromise(Effect.service(FlowEngineTag)),
      store,
    };
  };

  const slip = (steps: readonly string[]): Slip => ({
    slipVersion: 1,
    flowId: 'flow-x',
    recipe: 'spec',
    stages: [
      {
        name: 'main',
        steps: steps.map(step => ({
          ref: `contract.${step}@1`,
          step,
          cardinality: 'one' as const,
        })),
      },
    ],
    resolution: [],
    composedAt: '2026-01-01T00:00:00.000Z',
  });

  const settled = async (engine: { status: FlowEngine['status'] }) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const status = await Effect.runPromise(engine.status('flow-x'));
      if (status.state !== 'running') return status;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return Effect.runPromise(engine.status('flow-x'));
  };

  it('stops failed, at the step, when an undoing itself fails', async () => {
    const { engine } = await engineWith((step, kind) =>
      step === 'take' || kind === 'compensation'
        ? Effect.fail(new Unavailable({}))
        : Effect.void,
    );
    await Effect.runPromise(engine.start(slip(['hold', 'take']), 'k'));

    expect(await settled(engine)).toEqual({
      flowId: 'flow-x',
      state: 'failed',
      step: 'hold',
    });
  });

  it('interrupts a flow that has not reached a step', async () => {
    const { engine, store } = await engineWith(() => Effect.never);
    await Effect.runPromise(
      store.register('k2', {
        flowId: 'flow-y',
        executionId: 'never-run',
        state: 'running',
      }),
    );

    await Effect.runPromise(engine.interrupt('flow-y'));

    expect(await Effect.runPromise(engine.status('flow-y'))).toEqual({
      flowId: 'flow-y',
      state: 'interrupted',
    });
  });
});

describe('the in-memory status store', () => {
  it('ignores an update for a flow it never registered', async () => {
    const store = makeInMemoryFlowStatusStore();

    await Effect.runPromise(store.update('nobody', { state: 'completed' }));

    expect(Option.isNone(await Effect.runPromise(store.find('nobody')))).toBe(
      true,
    );
  });
});
