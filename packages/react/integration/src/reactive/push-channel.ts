import type { DomainEvent, EntityId } from '@entifix/core';
import { Context } from 'effect';

import { makePushRouter } from './push-router.js';

/**
 * What a tab can listen to: every change to one entity, one record, or one
 * flow's outcome
 * ([ADR 0021](../../../../../docs/adr/0021-server-push-and-the-multiplexed-channel.md)).
 */
export type PushTopic =
  `entity:${string}` | `record:${string}:${string}` | `flow:${string}`;

/** Every change to the entity whose `key ?? name` is `key`. */
export const entityTopic = (key: string): PushTopic => `entity:${key}`;

/** Every change to one record of an entity. */
export const recordTopic = (key: string, id: EntityId): PushTopic =>
  `record:${key}:${String(id)}`;

/** The outcome of one flow: its `flow.*` events. */
export const flowTopic = (flowId: string): PushTopic => `flow:${flowId}`;

/** Receives each event pushed on a topic it subscribed to, decoded. */
export type PushListener = (event: DomainEvent) => void;

/**
 * Receives the subscribed topics the server could not replay after a
 * reconnect. Whatever the listener shows for them must be read again.
 */
export type ResyncListener = (topics: readonly PushTopic[]) => void;

/**
 * The browser half of push: topics in, decoded events out.
 *
 * Commands never travel here; the stream is one-way and every write stays
 * HTTP. Each subscribe returns its own unsubscribe.
 */
export interface PushChannel {
  /**
   * Listens to one topic. A listener subscribed to several topics an event
   * names hears that event once.
   */
  subscribe(topic: PushTopic, listener: PushListener): () => void;
  /**
   * Runs whenever the stream is (re)connected, and **immediately if it is
   * already connected when the listener registers**. A consumer that may have
   * missed something while disconnected re-reads here; without the replay, one
   * mounting after the stream opened would wait for a drop that may never come.
   */
  onConnect(listener: () => void): () => void;
  /** Runs when the server asks for subscribed topics to be read again. */
  onResync(listener: ResyncListener): () => void;
}

export class PushChannelTag extends Context.Service<
  PushChannelTag,
  PushChannel
>()('@entifix/react-integration/PushChannel') {}

/**
 * A channel that never connects and never emits: the default until a host
 * provides a transport. Its consumers reconcile never, which is the honest
 * behaviour for a transport that is not there.
 */
export const NoopPushChannel: PushChannel = {
  subscribe: () => () => undefined,
  onConnect: () => () => undefined,
  onResync: () => () => undefined,
};

export interface InMemoryPushChannel extends PushChannel {
  /** Delivers `event` as a server would, naming the topics it matched. */
  emit(topics: readonly PushTopic[], event: DomainEvent): void;
  /** Announces a (re)connection and marks the channel connected. */
  connect(): void;
  /** Asks for `topics` to be read again, as a server's `resync` does. */
  resync(topics: readonly PushTopic[]): void;
  /** The topics something is subscribed to, sorted. */
  topics(): readonly PushTopic[];
}

/**
 * A synchronous channel for specs and mocks. It routes exactly as the
 * `EventSource` adapter does, because both run on the same router.
 */
export function makeInMemoryPushChannel(): InMemoryPushChannel {
  const router = makePushRouter();
  return {
    subscribe: router.subscribe,
    onConnect: router.onConnect,
    onResync: router.onResync,
    emit: router.deliver,
    connect: router.connected,
    resync: router.resync,
    topics: router.topics,
  };
}
