import { audienceAdmits, type DomainEvent } from '@entifix/core';
import { Effect, Queue, type Scope, Stream } from 'effect';

import type {
  PushConnectionUnderTest,
  PushMessageUnderTest,
  ServerPushContractOptions,
  ServerPushUnderTest,
} from '../contracts/server-push.contract.js';

/** An in-memory push port that also remembers everything published to it. */
export interface InMemoryServerPush extends ServerPushUnderTest {
  /** Every event published, in order, whether or not anyone received it. */
  readonly published: () => readonly DomainEvent[];
}

/**
 * A push port for a host's specs: each open connection gets its own queue,
 * filtered by topic and audience exactly as the real hub does, and every
 * publish is recorded so a spec can assert what a projection pushed without
 * opening a stream.
 */
export const makeInMemoryServerPush = ({
  topicsOf,
  admits = (event, connection) =>
    audienceAdmits(event.audience, connection.recipient),
  resume = (_cursor, topics) => Stream.make({ _tag: 'resync', topics }),
}: ServerPushContractOptions): Effect.Effect<
  InMemoryServerPush,
  never,
  Scope.Scope
> =>
  Effect.sync(() => {
    const published: DomainEvent[] = [];
    const open = new Map<
      Queue.Queue<PushMessageUnderTest>,
      PushConnectionUnderTest
    >();

    return {
      published: () => [...published],
      publish: event =>
        Effect.suspend(() => {
          published.push(event);
          return Effect.forEach(
            Array.from(open),
            ([queue, connection]) => {
              const topics = topicsOf(event).filter(topic =>
                connection.topics.includes(topic),
              );
              return topics.length > 0 && admits(event, connection)
                ? Queue.offer(queue, { _tag: 'event', event, topics })
                : Effect.void;
            },
            { discard: true },
          );
        }),
      open: connection =>
        Stream.unwrap(
          Effect.map(
            Effect.acquireRelease(
              Effect.tap(Queue.unbounded<PushMessageUnderTest>(), queue =>
                Effect.sync(() => open.set(queue, connection)),
              ),
              queue => Effect.sync(() => open.delete(queue)),
            ),
            queue => {
              const live = Stream.fromQueue(queue);
              return connection.cursor === undefined
                ? live
                : Stream.concat(
                    resume(connection.cursor, connection.topics),
                    live,
                  );
            },
          ),
        ),
    };
  });
