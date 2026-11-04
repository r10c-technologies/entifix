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
  /** What each wait was answered with, by step name. */
  readonly answered: Map<string, string | undefined>;
  /** Steps a guard passed over. */
  readonly skipped: Set<string>;
}

/** The outcome named on a signal's value or a timeout's, when a string. */
const outcomeOf = (value: unknown): string | undefined => {
  const named =
    typeof value === 'object' && value !== null
      ? (value as { readonly outcome?: unknown }).outcome
      : undefined;
  return typeof named === 'string' ? named : undefined;
};

const failureOf = (error: EntifixFailure) => ({
  code: error.code,
  category: error.category,
});

/**
 * An in-memory {@link FlowEngine} with the semantics a durable one must have
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)):
 * a failure before the commit point — the pivot's own included — compensates
 * the steps that succeeded, in reverse; a failure after it suspends the flow;
 * a `wait` parks it until a signal names that step, or until its `timeoutMs`
 * runs out and its `onTimeout` answers an outcome or strands the flow; a step
 * guarded on a wait's answer runs only on the outcomes it names. It runs
 * synchronously but for a timeout, and durably remembers nothing, which is
 * what makes it a fake.
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
        if (step.guard !== undefined) {
          const outcome = run.answered.get(step.guard.wait);
          if (
            run.skipped.has(step.guard.wait) ||
            outcome === undefined ||
            !step.guard.outcomes.includes(outcome)
          ) {
            run.skipped.add(step.step);
            run.next += 1;
            continue;
          }
        }
        run.step = step.step;
        if (kindOf(step) === 'wait') {
          run.state = 'waiting';
          // As the interpreter does from grammar 2: only a wait past the
          // commit point says the caller's write has landed.
          if (
            run.slip.slipVersion >= 2 &&
            commitAt !== -1 &&
            run.next > commitAt
          )
            announce(run, 'flow.waiting', step.step);
          armTimeout(run, step);
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

  /**
   * Answers a parked wait when its `timeoutMs` runs out, unless a signal came
   * first: with the outcome its `onTimeout` names, or by stranding the flow.
   * Named neither, a timeout is a failure past the commit point — suspended.
   */
  function armTimeout(run: Run, step: SlipStep): void {
    const timeoutMs = step.parameters?.['timeoutMs'];
    if (typeof timeoutMs !== 'number') return;
    const onTimeout = step.parameters?.['onTimeout'];
    Effect.runFork(
      Effect.sleep(timeoutMs).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (run.state !== 'waiting' || run.step !== step.step)
              return Effect.void;
            if (onTimeout === 'strand') {
              run.state = 'stranded';
              announce(run, 'flow.stranded', step.step);
              return Effect.void;
            }
            const outcome = outcomeOf(onTimeout);
            if (outcome === undefined) {
              run.state = 'suspended';
              announce(run, 'flow.suspended', step.step, {
                failure: { code: 'flowWaitTimedOut', category: 'timeout' },
              });
              return Effect.void;
            }
            return resume(run, step.step, { outcome });
          }),
        ),
      ),
    );
  }

  /** What a parked run's wait is correlated with, per its step's parameters. */
  const correlationOf = (run: Run) => {
    if (run.state !== 'waiting') return undefined;
    // A waiting run is parked on the step at `next`.
    const { parameters } = slipSteps(run.slip)[run.next] as SlipStep;
    const correlation = parameters?.['correlation'];
    return typeof correlation === 'string' ? correlation : undefined;
  };

  function resume(run: Run, token: string, value: unknown) {
    run.answered.set(token, outcomeOf(value));
    run.state = 'running';
    run.next += 1;
    return walk(run);
  }

  const signal = (token: string, value: unknown) => (run: Run) =>
    run.state !== 'waiting' || run.step !== token
      ? Effect.fail(new FlowSignalRejected({ flowId: run.slip.flowId, token }))
      : resume(run, token, value);

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
        const run: Run = {
          slip,
          state: 'running',
          next: 0,
          done: [],
          answered: new Map(),
          skipped: new Set(),
        };
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
    signal: (flowId, token, outcome) =>
      Effect.flatMap(find(flowId), signal(token, outcome)),
    signalCorrelated: (correlation, value) =>
      Effect.suspend(
        (): Effect.Effect<void, FlowNotFound | FlowSignalRejected> => {
          const run = [...runs.values()].find(
            candidate => correlationOf(candidate) === correlation,
          );
          if (run === undefined)
            return Effect.fail(new FlowNotFound({ flowId: correlation }));
          const token = run.step as string;
          const accepts = catalog.get(
            (slipSteps(run.slip)[run.next] as SlipStep).ref,
          )?.outcomes;
          return accepts !== undefined && !accepts.includes(value.outcome)
            ? Effect.fail(
                new FlowSignalRejected({ flowId: run.slip.flowId, token }),
              )
            : signal(token, value)(run);
        },
      ),
    interrupt: flowId =>
      Effect.map(find(flowId), run => {
        if (run.state === 'running' || run.state === 'waiting')
          run.state = 'interrupted';
      }),
  };
};
