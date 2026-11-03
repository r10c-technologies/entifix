import type { AudienceRecipient, DomainEvent } from '@entifix/core';
import { Effect, Fiber, type Scope, Stream } from 'effect';
import { describe, expect, it } from 'vitest';

/**
 * The push port as a case exercises it.
 *
 * Declared here structurally rather than imported, because the service shell
 * that owns the port depends on this package for its own specs; any
 * `ServerPush` satisfies it.
 */
export interface PushConnectionUnderTest {
  readonly recipient: AudienceRecipient;
  readonly topics: readonly string[];
  readonly cursor?: string;
}

export type PushMessageUnderTest =
  | {
      readonly _tag: 'event';
      readonly event: DomainEvent;
      readonly topics: readonly string[];
    }
  | { readonly _tag: 'resync'; readonly topics: readonly string[] };

export interface ServerPushUnderTest {
  readonly publish: (event: DomainEvent) => Effect.Effect<void>;
  readonly open: (
    connection: PushConnectionUnderTest,
  ) => Stream.Stream<PushMessageUnderTest>;
}

export interface ServerPushContractOptions {
  readonly topicsOf: (event: DomainEvent) => readonly string[];
  readonly admits?: (
    event: DomainEvent,
    connection: PushConnectionUnderTest,
  ) => boolean;
  readonly resume?: (
    cursor: string,
    topics: readonly string[],
  ) => Stream.Stream<PushMessageUnderTest>;
}

const event = (
  id: string,
  topic: string,
  audience?: DomainEvent['audience'],
): DomainEvent => ({
  name: 'thing.changed',
  id,
  source: 'contract',
  at: '2026-11-02T00:00:00.000Z',
  correlationId: id,
  ...(audience === undefined ? {} : { audience }),
  data: { topic },
});

const org = (id: string) => [{ kind: 'organization' as const, id }];

const topicsOf = (e: DomainEvent) => [(e.data as { topic: string }).topic];

/**
 * What every server-push adapter must guarantee
 * ([ADR 0021](../../../../../docs/adr/0021-server-push-and-the-multiplexed-channel.md)):
 * a connection receives only the topics it asked for and only what its
 * audience admits, each event naming which of its topics it matched; an event naming no audience reaches nobody; a flow event
 * reaches only the holder of its capability; a host filter replaces the
 * default; and a reconnect is answered by the resume hook before anything
 * live, or by a resync when the host has none.
 *
 * `make` builds a fresh port with the given options inside the case's scope.
 */
export const describeServerPushContract = (
  name: string,
  make: (
    options: ServerPushContractOptions,
  ) => Effect.Effect<ServerPushUnderTest, never, Scope.Scope>,
): void => {
  /**
   * Opens `connection`, publishes `events` once it is reading, and returns the
   * first `count` messages it received.
   */
  const receive = (
    options: ServerPushContractOptions,
    connection: PushConnectionUnderTest,
    events: readonly DomainEvent[],
    count: number,
  ) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const push = yield* make(options);
          const reading = yield* Effect.forkChild(
            Stream.runCollect(Stream.take(push.open(connection), count)),
          );
          // Let the connection subscribe before anything is published.
          yield* Effect.sleep('10 millis');
          yield* Effect.forEach(events, push.publish, { discard: true });
          return Array.from(yield* Fiber.join(reading));
        }),
      ),
    );

  const ids = (messages: readonly PushMessageUnderTest[]) =>
    messages.map(m => (m._tag === 'event' ? m.event.id : `resync:${m.topics}`));

  describe(`${name} — the server-push contract`, () => {
    it('delivers an event in a subscribed topic that its audience admits', async () => {
      const got = await receive(
        { topicsOf },
        { recipient: { organizationId: 'a' }, topics: ['entity:x'] },
        [event('e1', 'entity:x', org('a'))],
        1,
      );
      expect(ids(got)).toEqual(['e1']);
    });

    it('names the topics of the connection an event matched, and only those', async () => {
      const got = await receive(
        { topicsOf: () => ['entity:x', 'record:x:1', 'entity:y'] },
        {
          recipient: { organizationId: 'a' },
          topics: ['record:x:1', 'entity:x'],
        },
        [event('e1', 'entity:x', org('a'))],
        1,
      );
      expect(got[0]).toMatchObject({
        _tag: 'event',
        topics: ['entity:x', 'record:x:1'],
      });
    });

    it('withholds an event in a topic the connection did not ask for', async () => {
      const got = await receive(
        { topicsOf },
        { recipient: { organizationId: 'a' }, topics: ['entity:x'] },
        [event('e1', 'entity:y', org('a')), event('e2', 'entity:x', org('a'))],
        1,
      );
      expect(ids(got)).toEqual(['e2']);
    });

    it('reaches nobody with an event that names no audience', async () => {
      const got = await receive(
        { topicsOf },
        { recipient: { organizationId: 'a' }, topics: ['entity:x'] },
        [
          event('e1', 'entity:x'),
          event('e2', 'entity:x', []),
          event('e3', 'entity:x', org('a')),
        ],
        1,
      );
      expect(ids(got)).toEqual(['e3']);
    });

    it("never delivers one organization's event to another", async () => {
      const got = await receive(
        { topicsOf },
        { recipient: { organizationId: 'b' }, topics: ['entity:x'] },
        [event('e1', 'entity:x', org('a')), event('e2', 'entity:x', org('b'))],
        1,
      );
      expect(ids(got)).toEqual(['e2']);
    });

    it('delivers a flow event only to the holder of its capability digest', async () => {
      const flow = [{ kind: 'flow' as const, id: 'f-1', digest: 'd-1' }];
      const stranger = await receive(
        { topicsOf },
        { recipient: { flowDigests: ['d-2'] }, topics: ['flow:f-1'] },
        [
          event('e1', 'flow:f-1', flow),
          event('e2', 'flow:f-1', [{ kind: 'flow', id: 'f-1', digest: 'd-2' }]),
        ],
        1,
      );
      expect(ids(stranger)).toEqual(['e2']);
      const holder = await receive(
        { topicsOf },
        { recipient: { flowDigests: ['d-1'] }, topics: ['flow:f-1'] },
        [event('e1', 'flow:f-1', flow)],
        1,
      );
      expect(ids(holder)).toEqual(['e1']);
    });

    it("replaces the default with the host's filter", async () => {
      const got = await receive(
        { topicsOf, admits: e => e.id !== 'e1' },
        { recipient: {}, topics: ['entity:x'] },
        [event('e1', 'entity:x', org('a')), event('e2', 'entity:x')],
        1,
      );
      expect(ids(got)).toEqual(['e2']);
    });

    it('answers a reconnect from the resume hook before anything live', async () => {
      const got = await receive(
        {
          topicsOf,
          resume: (cursor, topics) =>
            Stream.make({ _tag: 'resync', topics: [`${cursor}>${topics}`] }),
        },
        {
          recipient: { organizationId: 'a' },
          topics: ['flow:f'],
          cursor: 'c-9',
        },
        [event('e1', 'flow:f', org('a'))],
        2,
      );
      expect(ids(got)).toEqual(['resync:c-9>flow:f', 'e1']);
    });

    it('asks a reconnect to re-read every topic when the host has no resume hook', async () => {
      const got = await receive(
        { topicsOf },
        {
          recipient: { organizationId: 'a' },
          topics: ['entity:x', 'record:x:1'],
          cursor: 'c-1',
        },
        [],
        1,
      );
      expect(got).toEqual([
        { _tag: 'resync', topics: ['entity:x', 'record:x:1'] },
      ]);
    });

    it('accepts a publish with no connection open', async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(make({ topicsOf }), push =>
            push.publish(event('e1', 'entity:x', org('a'))),
          ),
        ),
      );
    });
  });
};
