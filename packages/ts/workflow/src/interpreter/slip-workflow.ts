import {
  type FragmentCatalog,
  Slip,
  type SlipStep,
  slipSteps,
} from '@entifix/business/flow';
import {
  decodeProblem,
  type EntifixFailure,
  isFailure,
  JsonBody,
  problemOf,
} from '@entifix/core';
import { ParticipantClientTag } from '@entifix/transactions';
import { Effect, Exit, Schedule, Schema, SchemaTransformation } from 'effect';
import { Activity, DurableDeferred, Workflow } from 'effect/workflow';

import {
  type FlowRecordPatch,
  FlowStatusStoreTag,
} from '../status/flow-status-store.js';

/**
 * A failure as an Activity journals it: the problem body on the way in, the
 * failure its code names on the way out, so a resumed flow sees the typed
 * refusal a participant sent rather than a cast.
 */
export const JournaledFailure: Schema.Codec<EntifixFailure, unknown> =
  Schema.Unknown.pipe(
    Schema.decodeTo(
      Schema.declare((value): value is EntifixFailure => isFailure(value)),
      SchemaTransformation.transform({
        decode: body => decodeProblem(body),
        encode: failure => problemOf(failure),
      }),
    ),
  );

/**
 * How a flow ended, as the workflow's own result: every step ran, or a
 * refusal before the commit point was undone, or an undoing itself failed and
 * the flow stopped where it was — which a person has to look at.
 */
export const FlowOutcome = Schema.Literals([
  'completed',
  'compensated',
  'failed',
]);

/**
 * The one workflow every flow runs as: its payload is the pinned slip and the
 * idempotency key that started it
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)).
 * The execution id derives from the key, so the same key is the same flow.
 *
 * A flow suspended past its commit point is resumed on the retry schedule:
 * a participant that comes back gets the step again, idempotently.
 */
export const SlipWorkflow = Workflow.make('entifix/slip', {
  payload: { key: Schema.String, slip: Slip },
  idempotencyKey: payload => payload.key,
  success: FlowOutcome,
  // Its failure is what suspends it past the commit point; it is never the
  // flow's result.
  error: JournaledFailure,
  // Doubling from a second, never more than a minute apart.
  suspendedRetrySchedule: Schedule.min([
    Schedule.exponential('1 second'),
    Schedule.spaced('1 minute'),
  ]),
});

/** The durable wait a `wait` step parks on, addressed by the step's name. */
export const waitFor = (step: string) =>
  DurableDeferred.make(`wait:${step}`, { success: Schema.Unknown });

/** The index of the commit point — the first pivot — or `-1` for none. */
const commitPointOf = (steps: readonly SlipStep[], catalog: FragmentCatalog) =>
  steps.findIndex(step => catalog.get(step.ref)?.kind === 'pivot');

/**
 * Interprets a pinned slip
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)):
 * each step is an Activity named after it and keyed `<flowId>:<step>`, so a
 * resumed flow replays what already ran and calls a participant at most once
 * per step.
 *
 * - Before and at the commit point, a failure compensates what succeeded, in
 *   reverse, and the flow ends `compensated`.
 * - After it, a failure suspends the flow at that step — the money is taken,
 *   so the flow rolls forward when the participant comes back, never back.
 * - A `wait` step parks the flow on a durable deferred its signal completes.
 *
 * Compensation is explicit rather than a workflow finalizer, so the record
 * says `compensated` only after the last undoing has run — and an undoing
 * that fails stops the flow `failed` at that step instead of pretending.
 */
export const interpretSlip = (slip: Slip, catalog: FragmentCatalog) =>
  Effect.gen(function* () {
    const steps = slipSteps(slip);
    const commitPoint = commitPointOf(steps, catalog);
    const outputs: Record<string, unknown> = {};
    const done: SlipStep[] = [];

    const record = (name: string, patch: FlowRecordPatch) =>
      Activity.make({
        name,
        execute: Effect.flatMap(FlowStatusStoreTag, store =>
          store.update(slip.flowId, patch),
        ).pipe(Effect.orDie),
      });

    const call = (step: SlipStep, kind: 'action' | 'compensation') =>
      Activity.make({
        name: `${step.step}:${kind}`,
        // Whatever the participant answered, as JSON — `undefined` included,
        // which a journal cannot otherwise hold.
        success: JsonBody,
        error: JournaledFailure,
        execute: Effect.flatMap(ParticipantClientTag, participant =>
          participant.call({
            step,
            kind,
            idempotencyKey:
              kind === 'action'
                ? `${slip.flowId}:${step.step}`
                : `${slip.flowId}:${step.step}:compensation`,
            outputs,
          }),
        ),
      });

    for (const [index, step] of steps.entries()) {
      const fragment = catalog.get(step.ref);
      if (fragment?.kind === 'wait') {
        yield* record(`status:${step.step}:waiting`, {
          state: 'waiting',
          step: step.step,
          waitingFor: step.step,
        });
        outputs[step.step] = yield* DurableDeferred.await(waitFor(step.step));
        yield* record(`status:${step.step}:resumed`, {
          state: 'running',
          step: step.step,
        });
        continue;
      }

      yield* record(`status:${step.step}:running`, {
        state: 'running',
        step: step.step,
      });
      const exit = yield* Effect.exit(call(step, 'action'));
      if (Exit.isSuccess(exit)) {
        outputs[step.step] = exit.value;
        if (fragment?.kind === 'compensatable') done.push(step);
        continue;
      }

      if (commitPoint === -1 || index <= commitPoint) {
        for (const undone of [...done].reverse()) {
          const undoing = yield* Effect.exit(call(undone, 'compensation'));
          if (Exit.isFailure(undoing)) {
            yield* record(`status:${undone.step}:failed`, {
              state: 'failed',
              step: undone.step,
            });
            return 'failed' as const;
          }
        }
        yield* record(`status:${step.step}:compensated`, {
          state: 'compensated',
          step: step.step,
        });
        return 'compensated' as const;
      }

      yield* record(`status:${step.step}:suspended`, {
        state: 'suspended',
        step: step.step,
      });
      return yield* Effect.failCause(exit.cause).pipe(
        Effect.provideService(Workflow.SuspendOnFailure, true),
      );
    }

    yield* record('status:completed', { state: 'completed' });
    return 'completed' as const;
  });

/** The interpreter registered with the workflow engine, over one catalog. */
export const SlipWorkflowLayer = (catalog: FragmentCatalog) =>
  SlipWorkflow.toLayer(payload => interpretSlip(payload.slip, catalog));
