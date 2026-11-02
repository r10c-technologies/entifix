import { Declined, Internal } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  describeFlowEngineContract,
  flowEngineContractCatalog,
} from '../contracts/flow-engine.contract.js';
import { makeFakeFlowEngine } from './flow-engine.js';

describeFlowEngineContract('the fake engine', makeFakeFlowEngine);

const slip = {
  slipVersion: 1 as const,
  flowId: 'flow-1',
  recipe: 'contract',
  stages: [
    {
      name: 'main',
      steps: [
        { ref: 'contract.hold@1', step: 'hold', cardinality: 'one' as const },
        { ref: 'contract.take@1', step: 'take', cardinality: 'one' as const },
        {
          ref: 'contract.unknown@1',
          step: 'mystery',
          cardinality: 'one' as const,
        },
      ],
    },
  ],
  resolution: [],
  composedAt: '2026-01-01T00:00:00.000Z',
};

describe('makeFakeFlowEngine', () => {
  it('announces each flow event with the step as its id and the flow as audience', async () => {
    const engine = makeFakeFlowEngine(flowEngineContractCatalog, () =>
      Effect.succeed({}),
    );
    await Effect.runPromise(engine.start(slip, 'k'));

    expect(engine.events.map(event => [event.name, event.id])).toEqual([
      ['flow.started', 'flow-1:started'],
      ['flow.completed', 'flow-1:completed'],
    ]);
    expect(engine.events[1]?.audience).toEqual([
      { kind: 'flow', id: 'flow-1' },
    ]);
  });

  // A step the catalog does not know is treated as retriable: after the
  // commit point, so its failure suspends rather than compensating.
  it('suspends on an unknown step, and reports the failure’s code', async () => {
    const engine = makeFakeFlowEngine(flowEngineContractCatalog, step =>
      step.step === 'mystery'
        ? Effect.fail(new Internal())
        : Effect.succeed({}),
    );
    await Effect.runPromise(engine.start(slip, 'k'));

    expect(engine.events.at(-1)).toMatchObject({
      name: 'flow.suspended',
      data: { failure: { code: 'internal', category: 'internal' } },
    });
  });

  it('compensates the compensatable steps that succeeded, in reverse', async () => {
    const engine = makeFakeFlowEngine(flowEngineContractCatalog, step =>
      step.step === 'take' ? Effect.fail(new Declined({})) : Effect.succeed({}),
    );
    await Effect.runPromise(engine.start(slip, 'k'));

    expect(engine.compensations).toEqual(['compensate:hold']);
    expect(engine.events.at(-1)?.data.failure?.code).toBe('declined');
  });

  it('leaves a settled flow settled when interrupted', async () => {
    const engine = makeFakeFlowEngine(flowEngineContractCatalog, () =>
      Effect.succeed({}),
    );
    await Effect.runPromise(engine.start(slip, 'k'));
    await Effect.runPromise(engine.interrupt('flow-1'));

    expect((await Effect.runPromise(engine.status('flow-1'))).state).toBe(
      'completed',
    );
  });

  it('compensates a failure in a slip with no commit point at all', async () => {
    const engine = makeFakeFlowEngine(flowEngineContractCatalog, () =>
      Effect.fail(new Declined({})),
    );
    await Effect.runPromise(
      engine.start(
        {
          ...slip,
          stages: [
            {
              name: 'main',
              steps: [
                { ref: 'contract.hold@1', step: 'hold', cardinality: 'one' },
              ],
            },
          ],
        },
        'k',
      ),
    );

    expect((await Effect.runPromise(engine.status('flow-1'))).state).toBe(
      'compensated',
    );
  });

  // Only a compensatable step has anything to undo.
  it('skips a step that succeeded but has no compensation', async () => {
    const engine = makeFakeFlowEngine(flowEngineContractCatalog, step =>
      step.step === 'take' ? Effect.fail(new Declined({})) : Effect.succeed({}),
    );
    await Effect.runPromise(
      engine.start(
        {
          ...slip,
          stages: [
            {
              name: 'main',
              steps: [
                {
                  ref: 'contract.settle@1',
                  step: 'settle',
                  cardinality: 'one',
                },
                { ref: 'contract.take@1', step: 'take', cardinality: 'one' },
              ],
            },
          ],
        },
        'k',
      ),
    );

    expect(engine.compensations).toEqual([]);
  });

  it('finds no flow by a correlation its wait does not carry', async () => {
    const engine = makeFakeFlowEngine(flowEngineContractCatalog, () =>
      Effect.succeed({}),
    );
    await Effect.runPromise(
      engine.start(
        {
          ...slip,
          stages: [
            {
              name: 'main',
              steps: [
                {
                  ref: 'contract.await@1',
                  step: 'await',
                  cardinality: 'one' as const,
                },
              ],
            },
          ],
        },
        'k',
      ),
    );

    // A finished flow beside it is no candidate either.
    await Effect.runPromise(engine.start({ ...slip, flowId: 'flow-2' }, 'k2'));

    const missing = await Effect.runPromise(
      Effect.flip(engine.signalCorrelated('order-1', 'await', {})),
    );

    expect(missing._tag).toBe('FlowNotFound');
  });
});
