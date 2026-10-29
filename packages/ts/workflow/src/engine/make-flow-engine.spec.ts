import type { Slip, SlipStep } from '@entifix/business/flow';
import { Declined, type EntifixFailure, Unavailable } from '@entifix/core';
import { makeInMemoryOutbox } from '@entifix/testing-unit';
import {
  describeFlowEngineContract,
  flowEngineContractCatalog,
} from '@entifix/testing-unit/contracts';
import {
  CircuitBreakerTag,
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
import { Effect, Layer, ManagedRuntime, Option, Schedule } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { afterAll, describe, expect, it } from 'vitest';

import {
  type FlowDials,
  FlowWaitTimedOut,
} from '../interpreter/slip-workflow.js';
import {
  FlowStatusStoreTag,
  makeInMemoryFlowStatusStore,
} from '../status/flow-status-store.js';
import { FlowEngineLayer } from './make-flow-engine.js';

const runtimes: ManagedRuntime.ManagedRuntime<unknown, unknown>[] = [];
afterAll(async () => {
  for (const runtime of runtimes) await runtime.dispose();
});

type Call = (
  step: SlipStep,
  kind: 'action' | 'compensation',
) => Effect.Effect<unknown, EntifixFailure>;

/** An engine over the in-memory workflow engine, a fresh one per case. */
const engineOver = async (
  call: Call,
  options: { readonly dials?: Partial<FlowDials> } = {},
) => {
  const store = makeInMemoryFlowStatusStore();
  const outbox = makeInMemoryOutbox();
  const runtime = ManagedRuntime.make(
    FlowEngineLayer({
      catalog: flowEngineContractCatalog,
      source: 'spec',
      ...(options.dials === undefined ? {} : { dials: options.dials }),
    }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          WorkflowEngine.layerMemory,
          InMemoryCircuitBreakerLayer({ dials: { minimumCalls: 100 } }),
          InMemoryBulkheadLayer(),
          InMemoryRetryBudgetLayer(),
          Layer.succeed(FlowStatusStoreTag, store),
          Layer.succeed(OutboxTag, outbox),
          Layer.succeed(ParticipantClientTag, {
            call: ({ step, kind }) => call(step, kind),
          }),
        ),
      ),
    ) as Layer.Layer<FlowEngineTag | CircuitBreakerTag>,
  );
  runtimes.push(runtime as never);
  return {
    engine: await runtime.runPromise(Effect.service(FlowEngineTag)),
    breaker: await runtime.runPromise(Effect.service(CircuitBreakerTag)),
    store,
    outbox,
  };
};

describeFlowEngineContract(
  'the in-memory workflow engine',
  async (_catalog, participant) =>
    (
      await engineOver((step, kind) =>
        kind === 'action' ? participant(step) : Effect.void,
      )
    ).engine,
);

type StepSpec =
  | string
  | (Partial<SlipStep> & { readonly step: string; readonly fragment: string });

const stepOf = (spec: StepSpec): SlipStep => {
  if (typeof spec === 'string')
    return { ref: `contract.${spec}@1`, step: spec, cardinality: 'one' };
  const { fragment, ...rest } = spec;
  return { ref: `contract.${fragment}@1`, cardinality: 'one', ...rest };
};

const slipOf = (steps: readonly StepSpec[]): Slip => ({
  slipVersion: 1,
  flowId: 'flow-x',
  recipe: 'spec',
  stages: [{ name: 'main', steps: steps.map(stepOf) }],
  resolution: [],
  composedAt: '2026-01-01T00:00:00.000Z',
  audience: [{ kind: 'organization', id: 'org-1' }],
});

const settled = (engine: FlowEngine, flowId = 'flow-x') =>
  Effect.runPromise(
    engine.status(flowId).pipe(
      Effect.repeat({
        until: status => status.state !== 'running',
        schedule: Schedule.spaced('10 millis'),
        times: 300,
      }),
    ),
  );

const start = (engine: FlowEngine, slip: Slip) =>
  Effect.runPromise(engine.start(slip, `key-${slip.flowId}`));

describe('the slip interpreter', () => {
  it('announces the flow’s start and end through the outbox, to its audience', async () => {
    const { engine, outbox } = await engineOver(() =>
      Effect.succeed({ ok: true }),
    );
    await start(engine, slipOf(['hold', 'take', 'settle']));
    await settled(engine);

    expect(
      outbox.entries.map(entry => [entry.event.name, entry.version]),
    ).toEqual([
      ['flow.started', 0],
      ['flow.completed', 4],
    ]);
    expect(outbox.entries[0]?.event.audience).toEqual([
      { kind: 'flow', id: 'flow-x' },
      { kind: 'organization', id: 'org-1' },
    ]);
  });

  it('announces a compensated flow as failed, with the refusal’s code', async () => {
    const { engine, outbox } = await engineOver((step, kind) =>
      step.step === 'take' && kind === 'action'
        ? Effect.fail(new Declined({}))
        : Effect.void,
    );
    await start(engine, slipOf(['hold', 'take']));
    expect((await settled(engine)).state).toBe('compensated');

    expect(outbox.entries.at(-1)?.event).toMatchObject({
      name: 'flow.failed',
      data: { step: 'take', failure: { code: 'declined' } },
    });
  });

  it('announces a suspended flow, with the failure it stopped at', async () => {
    const { engine, outbox } = await engineOver((step, kind) =>
      step.step === 'settle' && kind === 'action'
        ? Effect.fail(new Declined({}))
        : Effect.void,
    );
    await start(engine, slipOf(['take', 'settle']));
    expect(await settled(engine)).toMatchObject({
      state: 'suspended',
      step: 'settle',
    });

    expect(outbox.entries.at(-1)?.event.name).toBe('flow.suspended');
  });

  it('stops failed, at the step, when an undoing itself fails', async () => {
    const { engine, outbox } = await engineOver((step, kind) =>
      step.step === 'take' || kind === 'compensation'
        ? Effect.fail(new Declined({}))
        : Effect.void,
    );
    await start(engine, slipOf(['hold', 'take']));

    expect(await settled(engine)).toEqual({
      flowId: 'flow-x',
      state: 'failed',
      step: 'hold',
    });
    expect(outbox.entries.at(-1)?.event.name).toBe('flow.failed');
  });

  it('retries a technical failure inside the step, under the budget', async () => {
    let attempts = 0;
    const { engine } = await engineOver(step =>
      Effect.suspend(() => {
        if (step.step !== 'hold') return Effect.void;
        attempts += 1;
        return attempts === 1 ? Effect.fail(new Unavailable({})) : Effect.void;
      }),
    );
    await start(engine, slipOf(['hold', 'take']));

    expect((await settled(engine)).state).toBe('completed');
    expect(attempts).toBe(2);
  });

  it('compensates fast before the commit point when the breaker is already open', async () => {
    let called = false;
    const { engine, breaker } = await engineOver(() =>
      Effect.sync(() => {
        called = true;
      }),
    );
    await Effect.runPromise(breaker.force('participant', 'forcedOpen'));
    await start(engine, slipOf(['hold', 'take']));

    expect((await settled(engine)).state).toBe('compensated');
    expect(called).toBe(false);
  });

  it('bounds each attempt and the step, and treats the bound as a failure', async () => {
    const { engine } = await engineOver(() => Effect.never, {
      dials: { attemptTimeoutMs: 10, stepTimeoutMs: 40 },
    });
    await start(engine, slipOf(['hold', 'take']));

    expect((await settled(engine)).state).toBe('compensated');
  });

  it('takes the timeout branch of a wait that names one, and refuses the late signal', async () => {
    const { engine } = await engineOver(() => Effect.void);
    await start(
      engine,
      slipOf([
        'take',
        { step: 'await', fragment: 'await', parameters: { timeoutMs: 20 } },
      ]),
    );
    // Parked first, then the clock wins the race.
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(await settled(engine)).toMatchObject({
      state: 'suspended',
      step: 'await',
    });
    const late = await Effect.runPromise(
      Effect.flip(engine.signal('flow-x', 'await', {})),
    );
    expect(late._tag).toBe('FlowSignalRejected');
  });

  it('continues a wait signalled before its timeout', async () => {
    const { engine } = await engineOver(() => Effect.void);
    await start(
      engine,
      slipOf([
        'take',
        { step: 'await', fragment: 'await', parameters: { timeoutMs: 60_000 } },
        'settle',
      ]),
    );
    expect((await settled(engine)).state).toBe('waiting');

    await Effect.runPromise(engine.signal('flow-x', 'await', { ok: true }));

    expect((await settled(engine)).state).toBe('completed');
  });

  it('runs a stage’s segments at once, and undoes every segment when one fails', async () => {
    const undone: string[] = [];
    const { engine } = await engineOver((step, kind) =>
      kind === 'compensation'
        ? Effect.sync(() => {
            undone.push(step.step);
          })
        : step.step === 'v2:hold'
          ? Effect.fail(new Declined({}))
          : Effect.void,
    );
    const slip: Slip = {
      ...slipOf([]),
      stages: [
        {
          name: 'reserve',
          steps: ['v1', 'v2'].map(vendor => ({
            ref: 'contract.hold@1',
            step: `${vendor}:hold`,
            cardinality: 'perVendor' as const,
            segment: { vendor },
          })),
        },
        { name: 'pay', steps: [stepOf('take')] },
      ],
    };
    await start(engine, slip);

    expect(await settled(engine)).toMatchObject({
      state: 'compensated',
      step: 'v2:hold',
    });
    expect(undone).toEqual(['v1:hold']);
  });

  it('decides on the earliest step when several segments fail', async () => {
    const { engine } = await engineOver((step, kind) =>
      kind === 'action' && step.step.endsWith(':hold')
        ? Effect.fail(new Declined({}))
        : Effect.void,
    );
    await start(engine, {
      ...slipOf([]),
      stages: [
        {
          name: 'reserve',
          steps: ['v1', 'v2'].map(vendor => ({
            ref: 'contract.hold@1',
            step: `${vendor}:hold`,
            cardinality: 'perVendor' as const,
            segment: { vendor },
          })),
        },
      ],
    });

    expect(await settled(engine)).toMatchObject({
      state: 'compensated',
      step: 'v1:hold',
    });
    expect(new FlowWaitTimedOut({ step: 'await' }).message).toBe(
      "the wait at 'await' timed out",
    );
  });

  it('interrupts a flow that has not reached a step', async () => {
    const { engine, store } = await engineOver(() => Effect.never);
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
  it('ignores an update for a flow it never registered, and finds no correlation', async () => {
    const store = makeInMemoryFlowStatusStore();

    await Effect.runPromise(store.update('nobody', { state: 'completed' }));

    expect(Option.isNone(await Effect.runPromise(store.find('nobody')))).toBe(
      true,
    );
    expect(
      Option.isNone(
        await Effect.runPromise(store.findByCorrelation('order-1')),
      ),
    ).toBe(true);
  });
});
