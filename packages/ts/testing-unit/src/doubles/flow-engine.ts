import type { FragmentCatalog, Slip, SlipStep } from '@entifix/business/flow';
import { slipSteps } from '@entifix/business/flow';
import { type DomainEvent, type EntifixFailure } from '@entifix/core';
import {
  type FlowEngine,
  flowEvent,
  type FlowEventData,
  FlowNotFound,
  FlowSignalRejected,
  type FlowState,
} from '@entifix/transactions';
import { Effect } from 'effect';

/** What a fake participant does for one step: succeed with an outcome, or fail. */
export type FakeParticipant = (
  step: SlipStep,
) => Effect.Effect<unknown, EntifixFailure>;

export interface FakeFlowEngine extends FlowEngine {
  /** Every `flow.*` event the engine announced, in order. */
  readonly events: readonly DomainEvent<FlowEventData>[];
  /** Every compensation it ran, as `compensate:<step>`, in order. */
  readonly compensations: readonly string[];
}

interface Run {
  readonly slip: Slip;
  state: FlowState;
  step?: string;
  /** The next step to run. */
  next: number;
  readonly done: SlipStep[];
}

const failureOf = (error: EntifixFailure) => ({
  code: error.code,
  category: error.category,
});

/**
 * An in-memory {@link FlowEngine} with the semantics a durable one must have
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)):
 * a failure before the commit point — the pivot's own included — compensates
 * the steps that succeeded, in reverse; a failure after it suspends the flow;
 * a `wait` parks it until a signal names that step. It runs synchronously and
 * durably remembers nothing, which is what makes it a fake.
 */
export const makeFakeFlowEngine = (
  catalog: FragmentCatalog,
  participant: FakeParticipant,
): FakeFlowEngine => {
  const runs = new Map<string, Run>();
  const byKey = new Map<string, string>();
  const events: DomainEvent<FlowEventData>[] = [];
  const compensations: string[] = [];

  const kindOf = (step: SlipStep) => catalog.get(step.ref)?.kind ?? 'retriable';

  const announce = (
    run: Run,
    name: DomainEvent['name'] & `flow.${string}`,
    step: string,
    extra: Partial<FlowEventData> = {},
  ) => {
    events.push(
      flowEvent({
        name: name as 'flow.started',
        source: 'fake-flow-engine',
        at: new Date(0).toISOString(),
        step,
        ordinal: events.length,
        audience: [{ kind: 'flow', id: run.slip.flowId }],
        data: {
          flowId: run.slip.flowId,
          definition: run.slip.recipe,
          slipVersion: run.slip.slipVersion,
          step,
          ...extra,
        },
      }),
    );
  };

  const walk = (run: Run): Effect.Effect<void> =>
    Effect.gen(function* () {
      const steps = slipSteps(run.slip);
      const commitAt = steps.findIndex(step => kindOf(step) === 'pivot');
      while (run.next < steps.length) {
        const step = steps[run.next] as SlipStep;
        run.step = step.step;
        if (kindOf(step) === 'wait') {
          run.state = 'waiting';
          return;
        }
        const result = yield* Effect.result(participant(step));
        if (result._tag === 'Failure') {
          const error = result.failure;
          const preCommit = commitAt === -1 || run.next <= commitAt;
          if (preCommit) {
            for (const done of [...run.done].reverse())
              if (kindOf(done) === 'compensatable')
                compensations.push(`compensate:${done.step}`);
            run.state = 'compensated';
            announce(run, 'flow.failed', step.step, {
              failure: failureOf(error),
            });
          } else {
            run.state = 'suspended';
            announce(run, 'flow.suspended', step.step, {
              failure: failureOf(error),
            });
          }
          return;
        }
        run.done.push(step);
        run.next += 1;
      }
      run.state = 'completed';
      run.step = undefined;
      announce(run, 'flow.completed', 'completed');
    });

  const find = (flowId: string) => {
    const run = runs.get(flowId);
    return run === undefined
      ? Effect.fail(new FlowNotFound({ flowId }))
      : Effect.succeed(run);
  };

  return {
    events,
    compensations,
    start: (slip, idempotencyKey) =>
      Effect.gen(function* () {
        const known = byKey.get(idempotencyKey);
        if (known !== undefined) return { flowId: known };
        const run: Run = { slip, state: 'running', next: 0, done: [] };
        runs.set(slip.flowId, run);
        byKey.set(idempotencyKey, slip.flowId);
        announce(run, 'flow.started', 'started');
        yield* walk(run);
        return { flowId: slip.flowId };
      }),
    status: flowId =>
      Effect.map(find(flowId), run => ({
        flowId,
        state: run.state,
        ...(run.step === undefined ? {} : { step: run.step }),
      })),
    signal: (flowId, token) =>
      Effect.flatMap(find(flowId), run => {
        if (run.state !== 'waiting' || run.step !== token)
          return Effect.fail(new FlowSignalRejected({ flowId, token }));
        run.state = 'running';
        run.next += 1;
        return walk(run);
      }),
    interrupt: flowId =>
      Effect.map(find(flowId), run => {
        if (run.state === 'running' || run.state === 'waiting')
          run.state = 'interrupted';
      }),
  };
};
