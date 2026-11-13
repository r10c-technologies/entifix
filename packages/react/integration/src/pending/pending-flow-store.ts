import type { DomainEvent, EntifixFailure } from '@entifix/core';
import { Effect, Result, Schema } from 'effect';

import { flowTopic, type PushTopic } from '../reactive/push-channel.js';

/**
 * The shape version of what a store persists. A stored value at any other
 * version is discarded, never migrated: the store is a cache of in-flight
 * work, and losing it costs a re-read
 * ([ADR 0022](../../../../../docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)).
 */
export const PENDING_FLOW_STORE_VERSION = 1;

/** One write the server handed to a flow, waiting for the flow's outcome. */
export interface PendingFlow {
  readonly flowId: string;
  /** Where the outcome is pushed: `flow:<flowId>`. */
  readonly topic: PushTopic;
  /** ISO-8601, when the write was answered `202`. */
  readonly createdAt: string;
  /** The flow's `status` link, read when its push may have been missed. */
  readonly status?: string;
  /** What the write meant, for the screen that resumes it. JSON only. */
  readonly intent?: unknown;
}

/**
 * How a pending flow ended. A `failed` outcome with no `failure` is a flow
 * nobody could account for within the age bound: it is no longer shown as
 * pending, and there is nothing to tell the user why.
 */
export type FlowOutcome =
  | { readonly kind: 'confirmed'; readonly event?: DomainEvent }
  | { readonly kind: 'failed'; readonly failure?: EntifixFailure };

/**
 * Where a store persists, supplied by the host and scoped by it to one
 * principal. Zustand's `StateStorage` satisfies it.
 */
export interface PendingFlowStorage {
  getItem(name: string): string | null | PromiseLike<string | null>;
  setItem(name: string, value: string): unknown;
}

export interface PendingFlowStoreOptions {
  /** Omitted, the store lives in memory and a reload forgets it. */
  readonly storage?: PendingFlowStorage;
  /** The storage key. Defaults to `entifix.pending-flows`. */
  readonly key?: string;
  /**
   * An anonymous scope keeps flow ids and their age only: an intent or a
   * status link could carry personal data or a capability, and nothing scopes
   * an anonymous storage to one person.
   */
  readonly anonymous?: boolean;
  readonly now?: () => Date;
}

export interface PendingFlowInput {
  readonly flowId: string;
  readonly status?: string;
  readonly intent?: unknown;
}

export interface PendingFlowStore {
  /** Settles once whatever was persisted has been read back. */
  readonly ready: Promise<void>;
  /** The pending flows, oldest first. The same array until something changes. */
  list(): readonly PendingFlow[];
  /**
   * Records a pending flow. Throws a `TypeError`, and records nothing, when
   * the intent is not JSON: a value that cannot be read back must never reach
   * storage.
   */
  add(input: PendingFlowInput): PendingFlow;
  /**
   * Ends a pending flow with its outcome. Answers `true` only for the call
   * that ended it, so a redelivered outcome is told apart from the first.
   */
  settle(flowId: string, outcome: FlowOutcome): boolean;
  /** Runs whenever the list changes. */
  subscribe(listener: () => void): () => void;
  /** Runs once, when the named flow settles. */
  onSettled(
    flowId: string,
    listener: (outcome: FlowOutcome) => void,
  ): () => void;
}

const isJson = (value: unknown): boolean => {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) return value.every(isJson);
      const prototype = Object.getPrototypeOf(value) as unknown;
      return (
        (prototype === Object.prototype || prototype === null) &&
        Object.values(value).every(isJson)
      );
    }
    default:
      return false;
  }
};

const Stored = Schema.Struct({
  v: Schema.Literal(PENDING_FLOW_STORE_VERSION),
  flows: Schema.Array(
    Schema.Struct({
      flowId: Schema.String,
      createdAt: Schema.String,
      status: Schema.optionalKey(Schema.String),
      intent: Schema.optionalKey(Schema.Unknown),
    }),
  ),
});

// Whatever the storage holds, as pending flows: nothing at all when it is
// missing, unreadable, or at another version.
const decodeStored = (raw: string | null): readonly PendingFlow[] => {
  if (raw === null) return [];
  const decoded = Effect.runSync(
    Effect.result(
      Effect.flatMap(
        Effect.try(() => JSON.parse(raw) as unknown),
        Schema.decodeUnknownEffect(Stored),
      ),
    ),
  );
  if (Result.isFailure(decoded)) return [];
  return decoded.success.flows.map(flow => ({
    ...flow,
    topic: flowTopic(flow.flowId),
  }));
};

/**
 * The pending-flow store: held in memory, written through to the host's
 * storage as `{ v, flows }`, and read back from it once on creation.
 */
export function makePendingFlowStore({
  storage,
  key = 'entifix.pending-flows',
  anonymous = false,
  now = () => new Date(),
}: PendingFlowStoreOptions = {}): PendingFlowStore {
  let flows: readonly PendingFlow[] = [];
  const listeners = new Set<() => void>();
  const settledListeners = new Map<
    string,
    Set<(outcome: FlowOutcome) => void>
  >();
  let writing: Promise<unknown> = Promise.resolve();

  const changed = (next: readonly PendingFlow[]): void => {
    flows = next;
    for (const listener of listeners) listener();
  };

  const persist = (): void => {
    if (storage === undefined) return;
    const value = JSON.stringify({ v: PENDING_FLOW_STORE_VERSION, flows });
    // Serialized, so a slow write never lands after a later one. A write that
    // fails costs only the reload-survival of what is pending.
    writing = writing
      .then(() => storage.setItem(key, value))
      .catch(() => undefined);
  };

  const ready =
    storage === undefined
      ? Promise.resolve()
      : Promise.resolve()
          .then(() => storage.getItem(key))
          .then(
            raw => decodeStored(raw),
            () => [],
          )
          .then(stored => {
            const held = new Set(flows.map(flow => flow.flowId));
            const restored = stored.filter(flow => !held.has(flow.flowId));
            if (restored.length > 0) changed([...restored, ...flows]);
          });

  return {
    ready,
    list: () => flows,
    add({ flowId, status, intent }) {
      if (!anonymous && intent !== undefined && !isJson(intent))
        throw new TypeError(
          `the intent of pending flow '${flowId}' is not JSON, so it cannot be stored`,
        );
      const flow: PendingFlow = {
        flowId,
        topic: flowTopic(flowId),
        createdAt: now().toISOString(),
        ...(anonymous || status === undefined ? {} : { status }),
        ...(anonymous || intent === undefined ? {} : { intent }),
      };
      changed([...flows.filter(held => held.flowId !== flowId), flow]);
      persist();
      return flow;
    },
    settle(flowId, outcome) {
      if (!flows.some(flow => flow.flowId === flowId)) return false;
      changed(flows.filter(flow => flow.flowId !== flowId));
      persist();
      const waiting = settledListeners.get(flowId);
      settledListeners.delete(flowId);
      for (const listener of waiting ?? []) listener(outcome);
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onSettled(flowId, listener) {
      const waiting = settledListeners.get(flowId) ?? new Set();
      settledListeners.set(flowId, waiting.add(listener));
      return () => {
        waiting.delete(listener);
      };
    },
  };
}
