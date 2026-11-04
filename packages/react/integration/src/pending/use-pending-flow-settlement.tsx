'use client';

import {
  decodeProblem,
  type DomainEvent,
  type EntifixFailure,
  Internal,
} from '@entifix/core';
import { FlowEventData, type FlowStatusBody } from '@entifix/transactions';
import { Effect, Schema } from 'effect';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { flowTopic, type PushChannel } from '../reactive/push-channel.js';
import type {
  FlowOutcome,
  PendingFlow,
  PendingFlowStore,
} from './pending-flow-store.js';

/** Reads a flow's `status` link; `undefined` is a flow not projected yet. */
export type FlowStatusRead = (
  href: string,
) => Effect.Effect<FlowStatusBody | undefined, unknown>;

export interface UsePendingFlowSettlementOptions {
  readonly channel: PushChannel;
  readonly store: PendingFlowStore;
  /**
   * Reads a flow's status when its push may have been missed: on every
   * (re)connection and on a resync. Omitted, a flow settles by push alone.
   */
  readonly readStatus?: FlowStatusRead;
  /**
   * How long a flow nobody can account for stays pending, in milliseconds.
   * Past it, a flow whose status read still answers `404` — or that has no
   * status link — is dropped as failed, with nothing to tell the user why.
   */
  readonly maxAgeMs: number;
  readonly now?: () => number;
  /**
   * The toast event: runs exactly once for each flow that failed with a
   * reason, carrying the decoded failure.
   */
  readonly onFailure?: (failure: EntifixFailure, flow: PendingFlow) => void;
  /** Runs once for each flow that completed. */
  readonly onConfirmed?: (flow: PendingFlow) => void;
}

const isFlowEvent = Schema.is(FlowEventData);

// A failure the flow named, decoded into its registered class; a flow that
// ended badly without naming one is an internal failure.
const failureOf = (
  named: FlowStatusBody['failure'] | undefined,
): EntifixFailure =>
  named === undefined ? new Internal() : decodeProblem(named);

/**
 * Settles every pending flow in `store`
 * ([ADR 0022](../../../../../docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)).
 *
 * Each pending flow's topic is subscribed: `flow.completed` confirms it, and so
 * does `flow.waiting` — a flow parked past its commit point has landed the
 * caller's write and waits on someone else — and `flow.failed` fails it. A push may have been missed while the stream was
 * down or before the topic was subscribed, so each (re)connection and each
 * resync re-reads the status of the flows it touches. A status read that
 * answers `404` means not projected yet, never failed. Mount it once, where
 * the host mounts its toast region.
 */
export function usePendingFlowSettlement({
  channel,
  store,
  readStatus,
  maxAgeMs,
  now = Date.now,
  onFailure,
  onConfirmed,
}: UsePendingFlowSettlementOptions): void {
  const flows = useSyncExternalStore(store.subscribe, store.list, store.list);
  const latest = useRef({ readStatus, maxAgeMs, now, onFailure, onConfirmed });
  useEffect(() => {
    latest.current = { readStatus, maxAgeMs, now, onFailure, onConfirmed };
  });

  // Settles one flow, telling the host only if this call is what settled it:
  // a redelivered outcome, or a push racing a status read, settles nothing.
  const settleIn =
    (held: PendingFlowStore) => (flow: PendingFlow, outcome: FlowOutcome) => {
      if (!held.settle(flow.flowId, outcome)) return;
      if (outcome.kind === 'confirmed') latest.current.onConfirmed?.(flow);
      else if (outcome.failure !== undefined)
        latest.current.onFailure?.(outcome.failure, flow);
    };
  const settleRef = useRef(settleIn);

  const key = flows.map(flow => flow.flowId).join(' ');
  useEffect(() => {
    const settle = settleRef.current(store);
    const onEvent = (flow: PendingFlow) => (event: DomainEvent) => {
      if (event.name === 'flow.completed' || event.name === 'flow.waiting')
        settle(flow, { kind: 'confirmed', event });
      else if (event.name === 'flow.failed' && isFlowEvent(event.data))
        settle(flow, {
          kind: 'failed',
          failure: failureOf(event.data.failure),
        });
    };
    const unsubscribes = store
      .list()
      .map(flow => channel.subscribe(flowTopic(flow.flowId), onEvent(flow)));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [channel, key, store]);

  useEffect(() => {
    const settle = settleRef.current(store);
    const expire = (flow: PendingFlow) => {
      const { now: clock, maxAgeMs: bound } = latest.current;
      if (clock() - Date.parse(flow.createdAt) > bound)
        settle(flow, { kind: 'failed' });
    };
    const reconcile = (pending: readonly PendingFlow[]) => {
      const read = latest.current.readStatus;
      for (const flow of pending) {
        if (read === undefined || flow.status === undefined) {
          expire(flow);
          continue;
        }
        void Effect.runPromise(
          Effect.match(read(flow.status), {
            // An unreachable status read is not an answer: the flow waits for
            // the next connection.
            onFailure: () => undefined,
            onSuccess: status => {
              switch (status?.state) {
                case undefined:
                  return expire(flow);
                case 'completed':
                  return settle(flow, { kind: 'confirmed' });
                // Parked past its commit point, the write has landed; parked
                // before it, nothing has, and the flow stays pending.
                case 'waiting':
                  return status.committed === true
                    ? settle(flow, { kind: 'confirmed' })
                    : undefined;
                case 'failed':
                case 'compensated':
                case 'interrupted':
                  return settle(flow, {
                    kind: 'failed',
                    failure: failureOf(status.failure),
                  });
                default:
                  return undefined;
              }
            },
          }),
        );
      }
    };
    const stopConnect = channel.onConnect(() => {
      void store.ready.then(() => reconcile(store.list()));
    });
    const stopResync = channel.onResync(topics => {
      reconcile(store.list().filter(flow => topics.includes(flow.topic)));
    });
    return () => {
      stopConnect();
      stopResync();
    };
  }, [channel, store]);
}
