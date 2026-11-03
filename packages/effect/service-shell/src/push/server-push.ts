import {
  audienceAdmits,
  type AudienceRecipient,
  type DomainEvent,
} from '@entifix/core';
import { Context, Effect, Metric, PubSub, type Scope, Stream } from 'effect';

/**
 * One open push connection: who holds it, what it asked for, and where it
 * left off.
 *
 * Every field comes from the request that opened it — the topics and the
 * cursor from its URL and `Last-Event-ID`, the recipient from the verified
 * session or the flow capabilities it presented. Nothing about a connection is
 * kept anywhere else, so any replica can answer its reconnect
 * ([ADR 0021](../../../../../docs/adr/0021-server-push-and-the-multiplexed-channel.md)).
 */
export interface PushConnection {
  readonly recipient: AudienceRecipient;
  /** `entity:<key>`, `record:<key>:<id>` or `flow:<id>`. */
  readonly topics: readonly string[];
  /** The `Last-Event-ID` the client reconnected with, if any. */
  readonly cursor?: string;
}

/**
 * What a connection receives: an event, with the topics of this connection it
 * matched, or a request to re-read some of its topics because what it missed
 * cannot be replayed.
 *
 * The matched topics travel with the event so the browser routes it to the
 * listeners that asked, without knowing the host's topic vocabulary.
 */
export type PushMessage =
  | {
      readonly _tag: 'event';
      readonly event: DomainEvent;
      readonly topics: readonly string[];
    }
  | { readonly _tag: 'resync'; readonly topics: readonly string[] };

/** The server half of push: what a publisher feeds and what a connection reads. */
export interface ServerPush {
  /** Offers one event to every open connection that subscribed and is admitted. */
  readonly publish: (event: DomainEvent) => Effect.Effect<void>;
  /**
   * The messages for one connection: the resume hook's catch-up first, then
   * every live event matching its topics and its audience, until the
   * connection's scope closes.
   */
  readonly open: (connection: PushConnection) => Stream.Stream<PushMessage>;
}

export class ServerPushTag extends Context.Service<ServerPushTag, ServerPush>()(
  '@entifix/service-shell/ServerPush',
) {}

export interface ServerPushOptions {
  /**
   * The topics an event belongs to. An event in no topic reaches nobody.
   *
   * Host vocabulary: an entity change might be `entity:<key>` and
   * `record:<key>:<id>`, a flow outcome `flow:<id>`.
   */
  readonly topicsOf: (event: DomainEvent) => readonly string[];
  /**
   * Whether a connection may receive an event it subscribed to. Defaults to
   * the event's own audience, which fails closed: an event naming no audience
   * reaches no connection.
   */
  readonly admits?: (event: DomainEvent, connection: PushConnection) => boolean;
  /**
   * What a reconnecting connection missed, answered from a read model the host
   * already has. Omitted, a connection with a cursor is told to re-read every
   * topic it holds.
   */
  readonly resume?: (
    cursor: string,
    topics: readonly string[],
  ) => Stream.Stream<PushMessage>;
}

/** Events a connection subscribed to but its audience did not admit. */
export const pushFiltered = Metric.counter('entifix_push_filtered_total', {
  description:
    'Pushed events withheld from a subscribed connection by its audience.',
});

const defaultAdmits = (event: DomainEvent, connection: PushConnection) =>
  audienceAdmits(event.audience, connection.recipient);

const resyncAll = (
  _cursor: string,
  topics: readonly string[],
): Stream.Stream<PushMessage> => Stream.make({ _tag: 'resync', topics });

/**
 * The in-process hub every connection on this replica reads from.
 *
 * One per process, fed by the host's broadcast subscription. It holds no
 * backlog: a connection that was not open when an event was published learns
 * of it through `resume`, never from here.
 */
export const makeServerPush = ({
  topicsOf,
  admits = defaultAdmits,
  resume = resyncAll,
}: ServerPushOptions): Effect.Effect<ServerPush, never, Scope.Scope> =>
  Effect.gen(function* () {
    const hub = yield* Effect.acquireRelease(
      PubSub.unbounded<DomainEvent>(),
      PubSub.shutdown,
    );

    // The event as this connection receives it, or `undefined` when it asked
    // for none of the event's topics or its audience does not admit it.
    const delivered = (connection: PushConnection) => {
      const wanted = new Set(connection.topics);
      return (event: DomainEvent): Effect.Effect<PushMessage | undefined> => {
        const topics = topicsOf(event).filter(topic => wanted.has(topic));
        if (topics.length === 0) return Effect.succeed(undefined);
        if (admits(event, connection))
          return Effect.succeed({ _tag: 'event', event, topics });
        return Effect.as(Metric.update(pushFiltered, 1), undefined);
      };
    };

    return {
      publish: event => Effect.asVoid(PubSub.publish(hub, event)),
      // Subscribed before the catch-up runs, so an event published while
      // `resume` is still reading is queued rather than falling in the gap
      // between the two.
      open: connection =>
        Stream.unwrap(
          Effect.map(PubSub.subscribe(hub), subscription => {
            const live = Stream.filter(
              Stream.mapEffect(
                Stream.fromSubscription(subscription),
                delivered(connection),
              ),
              (message): message is PushMessage => message !== undefined,
            );
            return connection.cursor === undefined
              ? live
              : Stream.concat(
                  resume(connection.cursor, connection.topics),
                  live,
                );
          }),
        ),
    };
  });
