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
  OutboxDrainTag,
  OutboxTag,
  ParticipantClientTag,
} from '@entifix/transactions';
import {
  InMemoryBulkheadLayer,
  InMemoryCircuitBreakerLayer,
  InMemoryRetryBudgetLayer,
} from '@entifix/transactions/engine';
import {
  Effect,
  Layer,
  ManagedRuntime,
  Metric,
  Option,
  Schedule,
} from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { afterAll, describe, expect, it } from 'vitest';

import {
  FlowWaitTimedOut,
  type InterpreterOptions,
} from '../interpreter/slip-workflow.js';
import {
  flowStates,
  FlowStatusStoreTag,
  makeInMemoryFlowStatusStore,
} from '../status/flow-status-store.js';
import { FlowEngineLayer, MemoryFlowEngineLayer } from './make-flow-engine.js';

const runtimes: ManagedRuntime.ManagedRuntime<unknown, unknown>[] = [];
afterAll(async () => {
  for (const runtime of runtimes) await runtime.dispose();
});

/** The suspensions counted so far; the registry is global, so a case reads a delta. */
const suspensions = () =>
  Effect.runPromise(
    Metric.value(
      Metric.withAttributes(flowStates, { state: 'suspended', source: 'spec' }),
    ).pipe(Effect.map(state => state.count)),
  );

type Call = (
  step: SlipStep,
  kind: 'action' | 'compensation',
  inputs: Readonly<Record<string, unknown>>,
) => Effect.Effect<unknown, EntifixFailure>;

/** An engine over the in-memory workflow engine, a fresh one per case. */
const engineOver = async (
  call: Call,
  options: Pick<InterpreterOptions, 'dials' | 'dialsFor'> & {
    readonly workflowEngine?: Layer.Layer<WorkflowEngine.WorkflowEngine>;
    /** Counts the drains a host's outbox would run, when given. */
    readonly drains?: { count: number };
  } = {},
) => {
  const store = makeInMemoryFlowStatusStore();
  const outbox = makeInMemoryOutbox();
  const runtime = ManagedRuntime.make(
    FlowEngineLayer({
      catalog: flowEngineContractCatalog,
      source: 'spec',
      ...(options.dials === undefined ? {} : { dials: options.dials }),
      ...(options.dialsFor === undefined ? {} : { dialsFor: options.dialsFor }),
    }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          options.workflowEngine ?? WorkflowEngine.layerMemory,
          InMemoryCircuitBreakerLayer({ dials: { minimumCalls: 100 } }),
          InMemoryBulkheadLayer(),
          InMemoryRetryBudgetLayer(),
          Layer.succeed(FlowStatusStoreTag, store),
          Layer.succeed(OutboxTag, outbox),
          options.drains === undefined
            ? Layer.empty
            : Layer.succeed(OutboxDrainTag, {
                now: Effect.sync(() => {
                  (options.drains as { count: number }).count += 1;
                }),
              }),
          Layer.succeed(ParticipantClientTag, {
            call: ({ step, kind, inputs }) => call(step, kind, inputs),
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

  it('drains the outbox after every announcement, where the host provides a drain', async () => {
    const drains = { count: 0 };
    const { engine, outbox } = await engineOver(
      () => Effect.succeed({ ok: true }),
      { drains },
    );
    await start(engine, slipOf(['hold', 'take', 'settle']));
    await settled(engine);

    // One drain per announcement, so neither waits for the relay's sweep.
    expect(drains.count).toBe(outbox.entries.length);
    expect(drains.count).toBeGreaterThan(0);
  });

  // The caller's write landed at the pivot; the wait after it is someone
  // else's, and saying so is what lets a browser stop holding the write.
  it('announces a wait past the commit point from grammar 2, and stays silent at one before it', async () => {
    const v2 = (steps: readonly StepSpec[]): Slip => ({
      ...slipOf(steps),
      slipVersion: 2,
    });
    const after = await engineOver(() => Effect.void);
    await start(after.engine, v2(['hold', 'take', 'await', 'settle']));
    expect((await settled(after.engine)).state).toBe('waiting');
    expect(
      after.outbox.entries.map(entry => [entry.event.name, entry.version]),
    ).toEqual([
      ['flow.started', 0],
      ['flow.waiting', 3],
    ]);
    expect(after.outbox.entries[1]?.event.audience).toEqual([
      { kind: 'flow', id: 'flow-x' },
      { kind: 'organization', id: 'org-1' },
    ]);

    const before = await engineOver(() => Effect.void);
    await start(before.engine, v2(['hold', 'await', 'take']));
    expect((await settled(before.engine)).state).toBe('waiting');
    expect(before.outbox.entries.map(entry => entry.event.name)).toEqual([
      'flow.started',
    ]);

    // A flow journaled under grammar 1 finishes under it, announcing nothing new.
    const v1 = await engineOver(() => Effect.void);
    await start(v1.engine, slipOf(['hold', 'take', 'await', 'settle']));
    expect((await settled(v1.engine)).state).toBe('waiting');
    expect(v1.outbox.entries.map(entry => entry.event.name)).toEqual([
      'flow.started',
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
    const before = await suspensions();
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
    expect(await suspensions()).toBe(before + 1);
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

  it('bounds a participant by its own dials over the defaults', async () => {
    const { engine } = await engineOver(() => Effect.never, {
      dialsFor: participant =>
        participant === 'participant'
          ? { attemptTimeoutMs: 10, stepTimeoutMs: 40 }
          : undefined,
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

  it('skips a guarded step when its wait was answered with no outcome at all', async () => {
    const called: string[] = [];
    const { engine } = await engineOver(step => {
      called.push(step.step);
      return Effect.void;
    });
    await start(
      engine,
      slipOf([
        'take',
        { step: 'report', fragment: 'report' },
        {
          step: 'close',
          fragment: 'close',
          guard: { wait: 'report', outcomes: ['delivered'] },
        },
      ]),
    );
    expect((await settled(engine)).state).toBe('waiting');

    // A plain signal names no outcome, so no guard on it can pass.
    await Effect.runPromise(engine.signal('flow-x', 'report', 'delivered'));

    expect((await settled(engine)).state).toBe('completed');
    expect(called).toEqual(['take']);
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

  it('hands a later step what an earlier one answered, and an undoing its own answer', async () => {
    const calls: string[] = [];
    const { engine } = await engineOver((step, kind, inputs) => {
      calls.push(`${kind}:${step.step}:${JSON.stringify(inputs)}`);
      if (kind === 'action' && step.step === 'v1:hold')
        return Effect.succeed({ data: { id: 'h-1' } });
      if (kind === 'action' && step.step === 'take')
        return Effect.fail(new Declined({}));
      return Effect.void;
    });
    const slip: Slip = {
      ...slipOf([]),
      stages: [
        {
          name: 'reserve',
          steps: [
            {
              ref: 'contract.hold@1',
              step: 'v1:hold',
              cardinality: 'perVendor',
              segment: { vendor: 'v1' },
              parameters: { organizationId: 'org-1' },
            },
          ],
        },
        { name: 'pay', steps: [stepOf('take')] },
      ],
    };
    await start(engine, slip);

    expect(await settled(engine)).toMatchObject({ state: 'compensated' });
    expect(calls).toEqual([
      'action:v1:hold:{"organizationId":"org-1"}',
      'action:take:{}',
      'compensation:v1:hold:{"organizationId":"org-1","id":"h-1"}',
    ]);
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

describe('a signal whose resume fails', () => {
  it.each([
    ['correlated', { correlation: 'order-7' }, {}],
    ['uncorrelated', {}, {}],
    [
      'an outcome-declaring',
      { correlation: 'order-7' },
      { accepts: ['delivered', 'refused'] },
    ],
  ] as const)(
    'parks a %s flow on its wait again, so a retried signal can claim it',
    async (_, parameters, parked) => {
      // The in-memory engine whose every deferred completion dies: the claim is
      // taken, the resume never lands.
      const unresumable = Layer.effect(
        WorkflowEngine.WorkflowEngine,
        Effect.map(
          Effect.service(WorkflowEngine.WorkflowEngine),
          (engine): WorkflowEngine.WorkflowEngine['Service'] => ({
            ...engine,
            deferredDone: () => Effect.die('the journal is unreachable'),
          }),
        ),
      ).pipe(Layer.provide(WorkflowEngine.layerMemory));
      const { engine, store } = await engineOver(() => Effect.succeed({}), {
        workflowEngine: unresumable,
      });
      const slip = slipOf([
        'take',
        {
          step: 'await',
          fragment: 'accepts' in parked ? 'report' : 'await',
          parameters,
        },
      ]);
      await start(engine, slip);
      expect((await settled(engine)).state).toBe('waiting');

      const exit = await Effect.runPromiseExit(
        engine.signal('flow-x', 'await', {}),
      );

      expect(exit._tag).toBe('Failure');
      expect(
        Option.getOrThrow(await Effect.runPromise(store.find('flow-x'))),
      ).toEqual({
        flowId: 'flow-x',
        executionId: expect.any(String),
        state: 'waiting',
        step: 'await',
        waitingFor: 'await',
        ...parameters,
        ...parked,
      });
    },
  );
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

  it('claims a wait once, only on the token it is parked on', async () => {
    const store = makeInMemoryFlowStatusStore();
    const run = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromise(effect);
    await run(
      store.register('k', { flowId: 'f', executionId: 'e', state: 'running' }),
    );
    await run(
      store.update('f', {
        state: 'waiting',
        step: 'await',
        waitingFor: 'await',
        correlation: 'order-7',
      }),
    );

    expect(await run(store.claimWait('f', 'elsewhere'))).toBe(false);
    expect(await run(store.claimWait('nobody', 'await'))).toBe(false);
    expect(await run(store.claimWait('f', 'await'))).toBe(true);
    expect(await run(store.claimWait('f', 'await'))).toBe(false);
    expect(Option.getOrThrow(await run(store.find('f')))).toEqual({
      flowId: 'f',
      executionId: 'e',
      state: 'running',
      step: 'await',
      correlation: 'order-7',
    });
  });

  it('claims a wait with no correlation and keeps none', async () => {
    const store = makeInMemoryFlowStatusStore();
    const run = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromise(effect);
    await run(
      store.register('k', { flowId: 'f', executionId: 'e', state: 'running' }),
    );
    await run(
      store.update('f', {
        state: 'waiting',
        step: 'await',
        waitingFor: 'await',
      }),
    );

    expect(await run(store.claimWait('f', 'await'))).toBe(true);
    expect(Option.getOrThrow(await run(store.find('f')))).toEqual({
      flowId: 'f',
      executionId: 'e',
      state: 'running',
      step: 'await',
    });
  });
});

describe('MemoryFlowEngineLayer', () => {
  it('runs a slip to its end over the in-memory workflow engine', async () => {
    const store = makeInMemoryFlowStatusStore();
    const runtime = ManagedRuntime.make(
      MemoryFlowEngineLayer({
        catalog: flowEngineContractCatalog,
        source: 'spec',
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            InMemoryCircuitBreakerLayer(),
            InMemoryBulkheadLayer(),
            InMemoryRetryBudgetLayer(),
            Layer.succeed(FlowStatusStoreTag, store),
            Layer.succeed(OutboxTag, makeInMemoryOutbox()),
            Layer.succeed(ParticipantClientTag, { call: () => Effect.void }),
          ),
        ),
      ),
    );
    runtimes.push(runtime as never);
    const engine = await runtime.runPromise(Effect.service(FlowEngineTag));

    await start(engine, slipOf(['hold', 'take', 'settle']));

    expect(await settled(engine)).toMatchObject({ state: 'completed' });
  });
});
