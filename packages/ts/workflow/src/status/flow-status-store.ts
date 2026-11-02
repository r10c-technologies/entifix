import type { StoreFailure } from '@entifix/core';
import type { FlowState } from '@entifix/transactions';
import { Context, Effect, Metric, Option } from 'effect';

/**
 * What the engine knows about one flow beyond its journal: the state a reader
 * is answered with, the step it is at, and the wait it is parked on.
 *
 * Kept beside the journal because the journal answers "did it finish" and
 * nothing finer — a flow parked on a signal and one mid-call look the same to
 * it, and a signal must be refused unless the flow is waiting for exactly it.
 */
export interface FlowRecord {
  readonly flowId: string;
  /** The workflow execution the flow runs as. */
  readonly executionId: string;
  readonly state: FlowState;
  readonly step?: string;
  /** The step whose signal the flow waits for, while `state` is `waiting`. */
  readonly waitingFor?: string;
  /** What that wait is correlated with — the order a delivery flow follows. */
  readonly correlation?: string;
}

/** A change to a flow's record: its new state, and where it now stands. */
export interface FlowRecordPatch {
  readonly state: FlowState;
  readonly step?: string;
  readonly waitingFor?: string;
  readonly correlation?: string;
}

export interface FlowStatusStore {
  /**
   * Records a flow under its idempotency key, unless the key already names
   * one — then that flow is answered and nothing is written, so a repeated
   * start finds the flow the first one started.
   */
  readonly register: (
    key: string,
    record: FlowRecord,
  ) => Effect.Effect<FlowRecord, StoreFailure>;
  readonly find: (
    flowId: string,
  ) => Effect.Effect<Option.Option<FlowRecord>, StoreFailure>;
  /** The flow parked on a wait correlated with `correlation`, if one is. */
  readonly findByCorrelation: (
    correlation: string,
  ) => Effect.Effect<Option.Option<FlowRecord>, StoreFailure>;
  readonly update: (
    flowId: string,
    patch: FlowRecordPatch,
  ) => Effect.Effect<void, StoreFailure>;
}

/**
 * Every state the interpreter journals a flow into, by state and the slice it
 * runs for. Counted inside the Activity that records it, so a replay — which
 * reads the journal rather than executing again — never counts a state twice.
 * `suspended` is the series to alert on: a flow past its commit point that
 * cannot go on, which a person has to look at.
 */
export const flowStates = Metric.counter('entifix_flow_states_total', {
  description: 'Flow states the interpreter journaled, by state and source.',
});

export class FlowStatusStoreTag extends Context.Service<
  FlowStatusStoreTag,
  FlowStatusStore
>()('@entifix/workflow/FlowStatusStore') {}

/**
 * A status store in memory, for a single process that keeps no flow past its
 * life — specs, and the in-memory workflow engine.
 */
export const makeInMemoryFlowStatusStore = (): FlowStatusStore => {
  const byKey = new Map<string, string>();
  const records = new Map<string, FlowRecord>();
  return {
    register: (key, record) =>
      Effect.sync(() => {
        const known = byKey.get(key);
        if (known !== undefined) return records.get(known) as FlowRecord;
        byKey.set(key, record.flowId);
        records.set(record.flowId, record);
        return record;
      }),
    find: flowId =>
      Effect.sync(() => Option.fromNullishOr(records.get(flowId))),
    findByCorrelation: correlation =>
      Effect.sync(() =>
        Option.fromNullishOr(
          [...records.values()].find(
            record => record.correlation === correlation,
          ),
        ),
      ),
    update: (flowId, patch) =>
      Effect.sync(() => {
        const current = records.get(flowId);
        if (current === undefined) return;
        records.set(flowId, {
          flowId: current.flowId,
          executionId: current.executionId,
          state: patch.state,
          ...(patch.step === undefined ? {} : { step: patch.step }),
          ...(patch.waitingFor === undefined
            ? {}
            : { waitingFor: patch.waitingFor }),
          ...(patch.correlation === undefined
            ? {}
            : { correlation: patch.correlation }),
        });
      }),
  };
};
