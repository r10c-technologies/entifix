import type { DomainEvent } from '@entifix/core';

import type {
  PushConnection,
  PushListener,
  PushTopic,
  ResyncListener,
} from './push-channel.js';

/**
 * The listener bookkeeping every `PushChannel` shares: who listens to which
 * topic, and who wants to hear about a connection or a resync. A transport
 * decides when those happen; this decides who hears.
 */
export interface PushRouter {
  subscribe(topic: PushTopic, listener: PushListener): () => void;
  onConnect(listener: () => void): () => void;
  onResync(listener: ResyncListener): () => void;
  /** Hands `event` to each listener of the named topics, once each. */
  deliver(topics: readonly string[], event: DomainEvent): void;
  /** Marks the channel connected and tells every connect listener. */
  connected(): void;
  /**
   * Marks the channel disconnected; a late connect listener then waits. With
   * a state, the drop is also one a reader should hear about — `reconnecting`
   * while the transport retries, `closed` when it gave up. Without one it is
   * a reopen the channel chose, which says nothing.
   */
  disconnected(state?: Exclude<PushConnection, 'open'>): void;
  /** Where the connection stands, as a reader would be told. */
  connection(): PushConnection;
  /** Runs whenever {@link connection} changes. */
  onConnectionChange(listener: () => void): () => void;
  /** Tells every resync listener, about the named topics still subscribed. */
  resync(topics: readonly string[]): void;
  /** The topics something is subscribed to, sorted. */
  topics(): readonly PushTopic[];
  /** Runs whenever the set of subscribed topics changes. */
  onTopicsChange(listener: () => void): void;
}

export function makePushRouter(): PushRouter {
  const byTopic = new Map<PushTopic, Set<PushListener>>();
  const connectListeners = new Set<() => void>();
  const resyncListeners = new Set<ResyncListener>();
  let isConnected = false;
  let topicsChanged = (): void => undefined;
  // Nothing to report until a drop is seen: a stream still opening is not news.
  let connection: PushConnection = 'open';
  const connectionListeners = new Set<() => void>();
  const setConnection = (next: PushConnection): void => {
    if (next === connection) return;
    connection = next;
    for (const listener of connectionListeners) listener();
  };

  const subscribed = (topics: readonly string[]): PushTopic[] =>
    topics.filter((topic): topic is PushTopic =>
      byTopic.has(topic as PushTopic),
    );

  return {
    subscribe(topic, listener) {
      let listeners = byTopic.get(topic);
      if (listeners === undefined) {
        listeners = new Set();
        byTopic.set(topic, listeners);
        topicsChanged();
      }
      listeners.add(listener);
      return () => {
        const current = byTopic.get(topic);
        if (current?.delete(listener) !== true || current.size > 0) return;
        byTopic.delete(topic);
        topicsChanged();
      };
    },
    onConnect(listener) {
      connectListeners.add(listener);
      if (isConnected) listener();
      return () => {
        connectListeners.delete(listener);
      };
    },
    onResync(listener) {
      resyncListeners.add(listener);
      return () => {
        resyncListeners.delete(listener);
      };
    },
    deliver(topics, event) {
      const named = new Set(topics);
      const listeners = new Set<PushListener>();
      for (const [topic, topicListeners] of byTopic)
        if (named.has(topic))
          for (const listener of topicListeners) listeners.add(listener);
      for (const listener of listeners) listener(event);
    },
    connected() {
      isConnected = true;
      setConnection('open');
      for (const listener of connectListeners) listener();
    },
    disconnected(state) {
      isConnected = false;
      if (state !== undefined) setConnection(state);
    },
    connection: () => connection,
    onConnectionChange(listener) {
      connectionListeners.add(listener);
      return () => {
        connectionListeners.delete(listener);
      };
    },
    resync(topics) {
      const still = subscribed(topics);
      if (still.length === 0) return;
      for (const listener of resyncListeners) listener(still);
    },
    topics: () => [...byTopic.keys()].sort(),
    onTopicsChange(listener) {
      topicsChanged = listener;
    },
  };
}
