import type { DomainEvent } from '@entifix/core';
import { describe, expect, it, vi } from 'vitest';

/**
 * The browser push port as a case exercises it.
 *
 * Declared here structurally rather than imported, because the package that
 * owns the port depends on this one for its own specs; any `PushChannel`
 * satisfies it.
 */
export interface PushChannelUnderTest {
  subscribe(topic: string, listener: (event: DomainEvent) => void): () => void;
  onConnect(listener: () => void): () => void;
  onResync(listener: (topics: readonly string[]) => void): () => void;
}

/**
 * One channel, and the server side of it as the adapter's transport would
 * play it.
 */
export interface PushChannelHarness {
  readonly channel: PushChannelUnderTest;
  /** Lets the channel act on a change of interest, such as a pending reopen. */
  readonly settle: () => void;
  /** The transport (re)connects. */
  readonly connect: () => void;
  /** The server pushes `event`, naming the topics it matched. */
  readonly push: (topics: readonly string[], event: DomainEvent) => void;
  /** The server asks for `topics` to be read again. */
  readonly resync: (topics: readonly string[]) => void;
}

/**
 * The event every case pushes. Its name is registered by the caller's own
 * spec support when its transport decodes through the registry.
 */
export const pushChannelContractEvent = (id: string): DomainEvent => ({
  name: 'push-channel-contract.thing.changed',
  id,
  source: 'contract',
  at: '2026-11-02T00:00:00.000Z',
  audience: [{ kind: 'organization', id: 'a' }],
  data: { n: 1 },
});

/**
 * What every browser push channel must guarantee
 * ([ADR 0021](../../../../../docs/adr/0021-server-push-and-the-multiplexed-channel.md)):
 * an event reaches the listeners of the topics it names and nobody else, once
 * per listener; an unsubscribed listener hears nothing more; a connect listener
 * hears every (re)connection and is told at once when it registers on a
 * connected channel; and a resync names only topics still subscribed.
 *
 * `make` builds a fresh channel and its harness for each case.
 */
export const describePushChannelContract = (
  name: string,
  make: () => PushChannelHarness,
): void => {
  const subscribe = (
    { channel }: PushChannelHarness,
    topic: string,
    listener: (event: DomainEvent) => void,
  ) => channel.subscribe(topic, listener);

  describe(`${name} — the push-channel contract`, () => {
    it('delivers an event to the listeners of the topics it names, and no others', () => {
      const h = make();
      const x = vi.fn();
      const y = vi.fn();
      subscribe(h, 'entity:x', x);
      subscribe(h, 'entity:y', y);
      h.settle();
      h.connect();
      h.push(['entity:x'], pushChannelContractEvent('e1'));
      expect(x).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'e1', data: { n: 1 } }),
      );
      expect(y).not.toHaveBeenCalled();
    });

    it('delivers once to a listener subscribed to two of the topics an event names', () => {
      const h = make();
      const listener = vi.fn();
      subscribe(h, 'entity:x', listener);
      subscribe(h, 'record:x:1', listener);
      h.settle();
      h.connect();
      h.push(['entity:x', 'record:x:1'], pushChannelContractEvent('e1'));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('ignores a topic the frame names but nobody here subscribed to', () => {
      const h = make();
      const listener = vi.fn();
      subscribe(h, 'entity:x', listener);
      h.settle();
      h.connect();
      h.push(['entity:z'], pushChannelContractEvent('e1'));
      expect(listener).not.toHaveBeenCalled();
    });

    it('stops delivering to a listener that unsubscribed, and tolerates a second unsubscribe', () => {
      const h = make();
      const gone = vi.fn();
      const kept = vi.fn();
      const unsubscribe = subscribe(h, 'entity:x', gone);
      subscribe(h, 'entity:x', kept);
      h.settle();
      h.connect();
      unsubscribe();
      unsubscribe();
      h.settle();
      h.push(['entity:x'], pushChannelContractEvent('e1'));
      expect(gone).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledTimes(1);
    });

    it('tells a connect listener of every connection, and at once when already connected', () => {
      const h = make();
      const early = vi.fn();
      h.channel.onConnect(early);
      subscribe(h, 'entity:x', vi.fn());
      h.settle();
      h.connect();
      h.connect();
      expect(early).toHaveBeenCalledTimes(2);

      const late = vi.fn();
      const stop = h.channel.onConnect(late);
      expect(late).toHaveBeenCalledTimes(1);
      stop();
      h.connect();
      expect(late).toHaveBeenCalledTimes(1);
    });

    it('names only topics still subscribed in a resync, and stays silent with none', () => {
      const h = make();
      const resynced = vi.fn();
      const stop = h.channel.onResync(resynced);
      subscribe(h, 'entity:x', vi.fn());
      h.settle();
      h.connect();
      h.resync(['entity:x', 'entity:gone']);
      h.resync(['entity:gone']);
      expect(resynced).toHaveBeenCalledTimes(1);
      expect(resynced).toHaveBeenCalledWith(['entity:x']);
      stop();
      h.resync(['entity:x']);
      expect(resynced).toHaveBeenCalledTimes(1);
    });
  });
};
