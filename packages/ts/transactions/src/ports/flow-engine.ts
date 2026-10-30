import type { Slip } from '@entifix/business/flow';
import { Failure, type StoreFailure } from '@entifix/core';
import { Context, type Effect, Schema } from 'effect';

/**
 * Where a flow stands. `suspended` is a flow past its commit point whose step
 * keeps failing — it is waiting for retries or an operator, never compensated;
 * `waiting` is a flow parked at a durable wait for a signal.
 */
export type FlowState =
  | 'running'
  | 'waiting'
  | 'suspended'
  | 'completed'
  | 'compensated'
  | 'failed'
  | 'interrupted';

export interface FlowStatus {
  readonly flowId: string;
  readonly state: FlowState;
  /** The step in progress, or the one the flow stopped at. */
  readonly step?: string;
}

/** No flow is known by this id. */
export class FlowNotFound extends Failure.notFound<FlowNotFound>()(
  'FlowNotFound',
  'flowNotFound',
  { flowId: Schema.String },
) {}

/**
 * A signal the flow will not take: it is not waiting, it waits for another
 * token, or the wait already timed out. A late signal is an answer, not an
 * outage.
 */
export class FlowSignalRejected extends Failure.conflict<FlowSignalRejected>()(
  'FlowSignalRejected',
  'flowSignalRejected',
  { flowId: Schema.String, token: Schema.String },
) {}

/**
 * Runs pinned slips durably
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)).
 *
 * There is deliberately no `await`: a caller learns how a flow ended from its
 * `flow.*` events, pushed, never by holding a request open on it.
 */
export interface FlowEngine {
  /** Starts a flow, idempotently: the same key answers the same `flowId`. */
  readonly start: (
    slip: Slip,
    idempotencyKey: string,
  ) => Effect.Effect<{ readonly flowId: string }, StoreFailure>;
  readonly status: (
    flowId: string,
  ) => Effect.Effect<FlowStatus, FlowNotFound | StoreFailure>;
  /** Completes a durable wait the flow is parked at. */
  readonly signal: (
    flowId: string,
    token: string,
    outcome: unknown,
  ) => Effect.Effect<void, FlowNotFound | FlowSignalRejected | StoreFailure>;
  /**
   * Completes a durable wait by what the waiting flow is correlated with —
   * the order a delivery flow follows, say — for a sender that knows that and
   * not the flow's id.
   */
  readonly signalCorrelated: (
    correlation: string,
    token: string,
    outcome: unknown,
  ) => Effect.Effect<void, FlowNotFound | FlowSignalRejected | StoreFailure>;
  readonly interrupt: (
    flowId: string,
  ) => Effect.Effect<void, FlowNotFound | StoreFailure>;
}

export class FlowEngineTag extends Context.Service<FlowEngineTag, FlowEngine>()(
  '@entifix/transactions/FlowEngine',
) {}
