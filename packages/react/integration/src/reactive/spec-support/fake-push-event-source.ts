import { type DomainEvent, encodeEvent, registerEvent } from '@entifix/core';
import { Effect, Schema } from 'effect';
import { vi } from 'vitest';

// The event the push-channel contract pushes, registered so this transport
// can decode it.
registerEvent(
  'push-channel-contract.thing.changed',
  Schema.Struct({ n: Schema.Number }),
);

type Listener = (message: { data: string; lastEventId: string }) => void;

/**
 * jsdom has no `EventSource`. This one records what the channel constructed
 * and lets a spec play the server: frames, named events, and the open.
 */
export class FakePushEventSource {
  static instances: FakePushEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FakePushEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: Listener | null = null;
  closed = false;
  readonly #named = new Map<string, Listener>();

  constructor(readonly url: string) {
    FakePushEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.#named.set(type, listener);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.readyState = FakePushEventSource.OPEN;
    this.onopen?.();
  }

  /** The stream drops: the browser retries, or has given up. */
  fail(state: 'reconnecting' | 'closed') {
    this.readyState =
      state === 'closed'
        ? FakePushEventSource.CLOSED
        : FakePushEventSource.CONNECTING;
    this.onerror?.();
  }

  /** A default-typed frame, with the `id:` the server would have sent. */
  message(data: string, lastEventId = '') {
    this.onmessage?.({ data, lastEventId });
  }

  /** A pushed event, framed as the SSE adapter frames it. */
  event(topics: readonly string[], event: DomainEvent) {
    const envelope = Effect.runSync(encodeEvent(event));
    this.message(JSON.stringify({ topics, envelope }), event.id);
  }

  named(type: string, data: string) {
    this.#named.get(type)?.({ data, lastEventId: '' });
  }
}

export const useFakePushEventSource = () => {
  FakePushEventSource.instances = [];
  vi.stubGlobal('EventSource', FakePushEventSource);
  return FakePushEventSource.instances;
};

/** The newest stream the channel opened. */
export const latest = (): FakePushEventSource => {
  const source = FakePushEventSource.instances.at(-1);
  if (source === undefined) throw new Error('no EventSource was opened');
  return source;
};
