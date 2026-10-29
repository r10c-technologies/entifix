import {
  type FlowEngine,
  FlowEngineTag,
  FlowNotFound,
  FlowSignalRejected,
} from '@entifix/transactions';
import { Context, Effect, Layer, Option } from 'effect';
import { DurableDeferred, WorkflowEngine } from 'effect/workflow';

import {
  type InterpreterOptions,
  SlipWorkflow,
  SlipWorkflowLayer,
  waitFor,
} from '../interpreter/slip-workflow.js';
import type { FlowRecord } from '../status/flow-status-store.js';
import { FlowStatusStoreTag } from '../status/flow-status-store.js';

/**
 * The flow engine port over Effect Workflow
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)).
 * A start records the flow under its key and executes the slip detached — it
 * answers the flow id, never the outcome, which arrives as `flow.*` events and
 * in the status record. A signal is accepted only by a flow parked on exactly
 * that wait.
 */
export const makeFlowEngine = Effect.gen(function* () {
  const context = yield* Effect.context<
    WorkflowEngine.WorkflowEngine | FlowStatusStoreTag
  >();
  const store = Context.get(context, FlowStatusStoreTag);
  const within = <A, E>(
    effect: Effect.Effect<A, E, WorkflowEngine.WorkflowEngine>,
  ) => Effect.provideContext(effect, context);

  const known = (flowId: string) =>
    Effect.flatMap(store.find(flowId), found =>
      Option.match(found, {
        onNone: () => Effect.fail(new FlowNotFound({ flowId })),
        onSome: Effect.succeed,
      }),
    );

  /** Completes the wait `record` is parked on, if `token` names it. */
  const complete = (token: string, outcome: unknown) => (record: FlowRecord) =>
    Effect.gen(function* () {
      if (record.state !== 'waiting' || record.waitingFor !== token)
        return yield* Effect.fail(
          new FlowSignalRejected({ flowId: record.flowId, token }),
        );
      const deferred = waitFor(token);
      yield* within(
        DurableDeferred.succeed(deferred, {
          token: DurableDeferred.tokenFromExecutionId(deferred, {
            workflow: SlipWorkflow,
            executionId: record.executionId,
          }),
          value: outcome,
        }),
      );
      // Recorded here as well as by the flow, so a second signal racing the
      // resume is refused rather than completing the wait twice.
      yield* store.update(record.flowId, { state: 'running', step: token });
    });

  const engine: FlowEngine = {
    start: (slip, idempotencyKey) =>
      Effect.gen(function* () {
        const payload = { key: idempotencyKey, slip };
        const executionId = yield* SlipWorkflow.executionId(payload);
        const record = yield* store.register(idempotencyKey, {
          flowId: slip.flowId,
          executionId,
          state: 'running',
        });
        if (record.executionId === executionId && record.flowId === slip.flowId)
          yield* within(SlipWorkflow.execute(payload, { discard: true }));
        return { flowId: record.flowId };
      }),

    status: flowId =>
      Effect.map(known(flowId), record => ({
        flowId: record.flowId,
        state: record.state,
        ...(record.step === undefined ? {} : { step: record.step }),
      })),

    signal: (flowId, token, outcome) =>
      Effect.flatMap(known(flowId), complete(token, outcome)),

    signalCorrelated: (correlation, token, outcome) =>
      Effect.gen(function* () {
        const found = yield* store.findByCorrelation(correlation);
        if (Option.isNone(found))
          return yield* Effect.fail(new FlowNotFound({ flowId: correlation }));
        return yield* complete(token, outcome)(found.value);
      }),

    interrupt: flowId =>
      Effect.gen(function* () {
        const record = yield* known(flowId);
        yield* within(SlipWorkflow.interrupt(record.executionId));
        yield* store.update(flowId, {
          state: 'interrupted',
          ...(record.step === undefined ? {} : { step: record.step }),
        });
      }),
  };
  return engine;
});

/**
 * The flow engine with the interpreter registered. Needs a workflow engine —
 * the in-memory one, or the cluster engine over Postgres from
 * `@entifix/workflow/postgres` — a status store, a participant client, the
 * outbox its events go through, and the breaker, bulkhead and retry budget
 * every call runs under.
 */
export const FlowEngineLayer = (options: InterpreterOptions) =>
  Layer.effect(FlowEngineTag, makeFlowEngine).pipe(
    Layer.provideMerge(SlipWorkflowLayer(options)),
  );
