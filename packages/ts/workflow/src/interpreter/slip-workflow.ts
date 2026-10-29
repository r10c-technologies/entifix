import {
  type FragmentCatalog,
  Slip,
  type SlipStep,
  slipSteps,
} from '@entifix/business/flow';
import {
  decodeProblem,
  type EntifixFailure,
  Failure,
  isFailure,
  JsonBody,
  problemOf,
  Timeout,
} from '@entifix/core';
import {
  BulkheadTag,
  CircuitBreakerTag,
  flowEvent,
  type FlowEventName,
  On,
  OutboxTag,
  ParticipantClientTag,
} from '@entifix/transactions';
import {
  Context,
  Effect,
  Exit,
  Schedule,
  Schema,
  SchemaTransformation,
} from 'effect';
import {
  Activity,
  DurableClock,
  DurableDeferred,
  Workflow,
} from 'effect/workflow';

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

/** A durable wait that outlived its timeout before its signal came. */
export class FlowWaitTimedOut extends Failure.timeout<FlowWaitTimedOut>()(
  'FlowWaitTimedOut',
  'flowWaitTimedOut',
  { step: Schema.String },
  { message: ({ step }) => `the wait at '${step}' timed out` },
) {}

/** How long a flow gives each participant call, and each step as a whole. */
export interface FlowDials {
  /** One attempt at a call. */
  readonly attemptTimeoutMs: number;
  /** Every attempt at a step together, retries included. */
  readonly stepTimeoutMs: number;
  /** Segments of one stage run at once. */
  readonly concurrency: number;
}

export const DEFAULT_FLOW_DIALS: FlowDials = {
  attemptTimeoutMs: 10_000,
  stepTimeoutMs: 60_000,
  concurrency: 4,
};

/** What the interpreter runs a slip with: the catalog, who announces, the dials. */
export interface InterpreterOptions {
  readonly catalog: FragmentCatalog;
  /** The slice the `flow.*` events are announced from. */
  readonly source: string;
  readonly dials?: Partial<FlowDials>;
}

/**
 * The interpreter's options, provided to the workflow it is registered with —
 * the payload is the slip; the catalog and dials are the deployment's.
 */
export class InterpreterOptionsTag extends Context.Service<
  InterpreterOptionsTag,
  InterpreterOptions
>()('@entifix/workflow/InterpreterOptions') {}

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

/** A step's failure, with the step it happened at. */
interface StepFailed {
  readonly step: SlipStep;
  readonly failure: EntifixFailure;
}

const segmentOf = (step: SlipStep) =>
  step.segment === undefined
    ? undefined
    : [step.segment.vendor, step.segment.paymentMethod]
        .filter(Boolean)
        .join('/');

/**
 * A stage's steps as the groups that run at once: one group per segment when
 * every step names one — a basket's vendors, joined before the shared pivot —
 * and otherwise one group, in order.
 */
const groupsOf = (steps: readonly SlipStep[]): readonly SlipStep[][] => {
  if (steps.some(step => segmentOf(step) === undefined)) return [[...steps]];
  const groups = new Map<string, SlipStep[]>();
  for (const step of steps) {
    const key = segmentOf(step) as string;
    groups.set(key, [...(groups.get(key) ?? []), step]);
  }
  return [...groups.values()];
};

/**
 * Interprets a pinned slip of grammar version 1
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)):
 * each step is an Activity named after it and keyed `<flowId>:<step>`, so a
 * resumed flow replays what already ran and calls a participant at most once
 * per step. Inside the Activity the call runs under the participant's
 * breaker and bulkhead and the retry budget, each attempt bounded and the
 * step as a whole bounded; nothing retries outside it.
 *
 * - Before and at the commit point, a failure — a breaker already open
 *   included, which fails fast — compensates what succeeded, in reverse, and
 *   the flow ends `compensated`.
 * - After it, a failure suspends the flow at that step: the money is taken,
 *   so the flow rolls forward when the participant comes back, never back.
 * - A `wait` step parks the flow on a durable deferred its signal completes,
 *   raced with a durable clock when it names `timeoutMs`; it may name a
 *   `correlation`, so a sender that knows the order rather than the flow can
 *   complete it.
 * - The segments of a stage run at once, bounded, and join before the next.
 *
 * Every transition is announced as a `flow.*` event through the outbox, by an
 * Activity, so it is written once whatever replays. Compensation is explicit
 * rather than a workflow finalizer, so the record says `compensated` only
 * after the last undoing has run — and an undoing that fails stops the flow
 * `failed` at that step instead of pretending.
 */
const interpretV1 = (slip: Slip) =>
  Effect.gen(function* () {
    const options = yield* InterpreterOptionsTag;
    const dials = { ...DEFAULT_FLOW_DIALS, ...options.dials };
    const { catalog } = options;
    const steps = slipSteps(slip);
    const ordinalOf = (step: SlipStep) => steps.indexOf(step) + 1;
    const commitPoint = steps.findIndex(
      step => catalog.get(step.ref)?.kind === 'pivot',
    );
    const outputs: Record<string, unknown> = {};
    const done: SlipStep[] = [];

    const record = (name: string, patch: FlowRecordPatch) =>
      Activity.make({
        name,
        execute: Effect.flatMap(FlowStatusStoreTag, store =>
          store.update(slip.flowId, patch),
        ).pipe(Effect.orDie),
      });

    const announce = (
      name: FlowEventName,
      step: string,
      ordinal: number,
      failure?: EntifixFailure,
    ) =>
      Activity.make({
        name: `announce:${name}:${step}`,
        execute: Effect.flatMap(OutboxTag, outbox =>
          outbox.enqueue(
            flowEvent({
              name,
              source: options.source,
              at: new Date().toISOString(),
              step: `${name}:${step}`,
              ordinal,
              audience: [
                { kind: 'flow', id: slip.flowId },
                ...(slip.audience ?? []),
              ],
              data: {
                flowId: slip.flowId,
                definition: slip.recipe,
                slipVersion: slip.slipVersion,
                step,
                ...(failure === undefined
                  ? {}
                  : {
                      failure: {
                        code: failure.code,
                        category: failure.category,
                      },
                    }),
              },
            }),
          ),
        ).pipe(Effect.orDie),
      });

    /** One call, bounded, under the participant's breaker, bulkhead and budget. */
    const guarded = (
      step: SlipStep,
      attempt: Effect.Effect<unknown, EntifixFailure>,
    ) =>
      Effect.gen(function* () {
        const key = step.participant ?? 'participant';
        const breaker = yield* CircuitBreakerTag;
        const bulkhead = yield* BulkheadTag;
        const timedOut = () => Effect.fail(new Timeout({ dependency: key }));
        return yield* breaker
          .guard(key)(
            bulkhead.withPermit(key)(
              attempt.pipe(
                Effect.timeoutOrElse({
                  duration: dials.attemptTimeoutMs,
                  orElse: timedOut,
                }),
              ),
            ),
          )
          .pipe(
            On(Failure.isFamily('technical')).retry({
              key: { dependency: key },
              idempotent: true,
            }),
            Effect.timeoutOrElse({
              duration: dials.stepTimeoutMs,
              orElse: timedOut,
            }),
          );
      });

    const call = (step: SlipStep, kind: 'action' | 'compensation') =>
      Activity.make({
        name: `${step.step}:${kind}`,
        // Whatever the participant answered, as JSON — `undefined` included,
        // which a journal cannot otherwise hold.
        success: JsonBody,
        error: JournaledFailure,
        execute: Effect.flatMap(ParticipantClientTag, participant =>
          guarded(
            step,
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
        ),
      });

    const wait = (step: SlipStep) =>
      Effect.gen(function* () {
        const correlation = step.parameters?.['correlation'];
        yield* record(`status:${step.step}:waiting`, {
          state: 'waiting',
          step: step.step,
          waitingFor: step.step,
          ...(typeof correlation === 'string' ? { correlation } : {}),
        });
        const signalled = DurableDeferred.await(waitFor(step.step));
        const timeoutMs = step.parameters?.['timeoutMs'];
        // A durable race, so a replay answers the branch that won rather than
        // racing again.
        outputs[step.step] =
          typeof timeoutMs === 'number'
            ? yield* DurableDeferred.raceAll({
                name: `race:${step.step}`,
                success: Schema.Unknown,
                error: FlowWaitTimedOut,
                effects: [
                  signalled,
                  DurableClock.sleep({
                    name: `timeout:${step.step}`,
                    duration: timeoutMs,
                  }).pipe(
                    Effect.andThen(
                      Effect.fail(new FlowWaitTimedOut({ step: step.step })),
                    ),
                  ),
                ],
              })
            : yield* signalled;
        yield* record(`status:${step.step}:resumed`, {
          state: 'running',
          step: step.step,
        });
      });

    /** One step, its failure tagged with where it happened. */
    const run = (step: SlipStep) =>
      Effect.gen(function* () {
        if (catalog.get(step.ref)?.kind === 'wait')
          return yield* wait(step).pipe(
            Effect.mapError((failure): StepFailed => ({ step, failure })),
          );
        yield* record(`status:${step.step}:running`, {
          state: 'running',
          step: step.step,
        });
        outputs[step.step] = yield* call(step, 'action').pipe(
          Effect.mapError((failure): StepFailed => ({ step, failure })),
        );
        if (catalog.get(step.ref)?.kind === 'compensatable') done.push(step);
      });

    yield* announce('flow.started', 'started', 0);

    for (const stage of slip.stages) {
      const exits = yield* Effect.forEach(
        groupsOf(stage.steps),
        group => Effect.exit(Effect.forEach(group, run, { discard: true })),
        { concurrency: dials.concurrency },
      );
      // The earliest step that failed decides; a group's failure is its own.
      const [first] = exits
        .flatMap(exit =>
          Exit.isFailure(exit)
            ? exit.cause.reasons.flatMap(reason =>
                // A durable race fails with its losers' interruptions beside
                // the failure that won, so the failure is looked for.
                reason._tag === 'Fail' ? [reason.error] : [],
              )
            : [],
        )
        .sort((a, b) => ordinalOf(a.step) - ordinalOf(b.step));
      if (first === undefined) continue;

      const { step, failure } = first;
      if (commitPoint === -1 || steps.indexOf(step) <= commitPoint) {
        for (const undone of [...done].reverse()) {
          const undoing = yield* Effect.exit(call(undone, 'compensation'));
          if (Exit.isFailure(undoing)) {
            yield* record(`status:${undone.step}:failed`, {
              state: 'failed',
              step: undone.step,
            });
            yield* announce(
              'flow.failed',
              undone.step,
              ordinalOf(undone),
              failure,
            );
            return 'failed' as const;
          }
        }
        yield* record(`status:${step.step}:compensated`, {
          state: 'compensated',
          step: step.step,
        });
        yield* announce('flow.failed', step.step, ordinalOf(step), failure);
        return 'compensated' as const;
      }

      yield* record(`status:${step.step}:suspended`, {
        state: 'suspended',
        step: step.step,
      });
      yield* announce('flow.suspended', step.step, ordinalOf(step), failure);
      return yield* Effect.fail(failure).pipe(
        Effect.provideService(Workflow.SuspendOnFailure, true),
      );
    }

    yield* record('status:completed', { state: 'completed' });
    yield* announce('flow.completed', 'completed', steps.length + 1);
    return 'completed' as const;
  });

/**
 * One interpreter per grammar version a slip can be written in. A flow runs
 * to its end under the grammar it started with, so a change to how steps are
 * walked — their order, their Activity names — is a new entry here, never an
 * edit to an existing one; the journal replay holds every entry to its
 * recorded command sequence.
 */
const INTERPRETERS = { 1: interpretV1 } as const satisfies Record<
  Slip['slipVersion'],
  (slip: Slip) => unknown
>;

/** Every `slipVersion` the interpreter walks — each must have a journal. */
export const interpretedSlipVersions: readonly number[] =
  Object.keys(INTERPRETERS).map(Number);

export const interpretSlip = (slip: Slip) =>
  INTERPRETERS[slip.slipVersion](slip);

/** The interpreter registered with the workflow engine, with its options. */
export const SlipWorkflowLayer = (options: InterpreterOptions) =>
  SlipWorkflow.toLayer(payload =>
    interpretSlip(payload.slip).pipe(
      Effect.provideService(InterpreterOptionsTag, options),
    ),
  );
