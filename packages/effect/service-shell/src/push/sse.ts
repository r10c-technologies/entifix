import { type DomainEvent, encodeEvent } from '@entifix/core';
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Metric,
  Ref,
  type Scope,
  Stream,
} from 'effect';
import { HttpServerResponse } from 'effect/http';

import {
  type PushConnection,
  type PushMessage,
  ServerPushTag,
} from './server-push.js';

/**
 * How often an idle push connection sends a comment frame.
 *
 * 15 s sits under the common 30 s idle timeout with room for one lost frame.
 * An edge in front of the stream must hold an idle connection for more than
 * twice this, or it closes healthy streams
 * ([ADR 0021](../../../../../docs/adr/0021-server-push-and-the-multiplexed-channel.md)).
 */
export const PUSH_HEARTBEAT = Duration.seconds(15);

export interface SsePushDials {
  /**
   * The range a connection's `retry:` is drawn from, in milliseconds.
   *
   * Drawn per connection, so a redeploy that closes every stream at once does
   * not have every browser reconnect in the same instant.
   */
  readonly retryMs: { readonly min: number; readonly max: number };
  /** How long before the token's `exp` the connection asks for a reauth. */
  readonly reauthMarginMs: number;
  /**
   * How long a shutdown waits for its drained connections to send their last
   * frame, in milliseconds. Defaults to 5 000.
   */
  readonly drainWindowMs?: number;
  /** Injectable for tests; `[0, 1)`, defaults to `Math.random`. */
  readonly random?: () => number;
}

export interface SsePushConnection extends PushConnection {
  /**
   * Unix seconds at which the credential that opened the stream expires — the
   * verified token's `exp`. Omitted for a connection with no expiring
   * credential, such as one opened with flow capabilities only.
   */
  readonly expiresAt?: number;
}

export interface SsePush {
  /** Serves one connection as `text/event-stream`. */
  readonly respond: (
    connection: SsePushConnection,
  ) => HttpServerResponse.HttpServerResponse;
}

/** Open push connections on this process. */
export const pushConnections = Metric.gauge('entifix_push_connections', {
  description: 'Open server-push connections.',
});
export const pushOpened = Metric.counter('entifix_push_opened_total', {
  description: 'Server-push connections opened.',
});
export const pushClosed = Metric.counter('entifix_push_closed_total', {
  description: 'Server-push connections closed, for any reason.',
});
export const pushDrained = Metric.counter('entifix_push_drained_total', {
  description: 'Server-push connections closed by a drain on shutdown.',
});
export const pushReauth = Metric.counter('entifix_push_reauth_total', {
  description: 'Server-push connections asked to reauthenticate before exp.',
});
export const pushUnencodable = Metric.counter(
  'entifix_push_unencodable_total',
  { description: 'Pushed events dropped because they do not encode.' },
);

const encoder = new TextEncoder();

const eventFrame = (event: DomainEvent): Effect.Effect<string | undefined> =>
  Effect.exit(encodeEvent(event)).pipe(
    Effect.flatMap(encoded =>
      Exit.isSuccess(encoded)
        ? Effect.succeed(
            `id: ${event.id}\ndata: ${JSON.stringify(encoded.value)}\n\n`,
          )
        : Effect.as(Metric.update(pushUnencodable, 1), undefined),
    ),
  );

const frameOf = (message: PushMessage): Effect.Effect<string | undefined> =>
  message._tag === 'event'
    ? eventFrame(message.event)
    : Effect.succeed(
        `event: resync\ndata: ${JSON.stringify({ topics: message.topics })}\n\n`,
      );

type Ending = 'reauth' | 'drain';

/**
 * The SSE adapter of the push port.
 *
 * Every connection opens with its own randomized `retry:`, sends a comment
 * every {@link PUSH_HEARTBEAT}, asks for a reauth at `exp − margin` and closes
 * cleanly instead of failing a reconnect with a 401, and is drained — a fresh
 * `retry:` and then EOF — when this adapter's scope closes.
 */
export const makeSsePush = ({
  retryMs,
  reauthMarginMs,
  drainWindowMs = 5_000,
  random = Math.random,
}: SsePushDials): Effect.Effect<SsePush, never, ServerPushTag | Scope.Scope> =>
  Effect.gen(function* () {
    const push = yield* ServerPushTag;
    // Each open connection's drain signal, and what it completes once its last
    // frame is out.
    const live = new Map<Deferred.Deferred<void>, Deferred.Deferred<void>>();

    const retry = () =>
      Math.round(retryMs.min + random() * (retryMs.max - retryMs.min));

    // Drain on shutdown: every connection still open is told to come back
    // later, at its own randomized interval, and then ends. The finalizer waits
    // for those last frames — up to the window — because the hub the
    // connections read from closes right after it.
    yield* Effect.addFinalizer(() => {
      const open = Array.from(live);
      return Effect.forEach(
        open,
        ([drain]) => Deferred.succeed(drain, undefined),
        { discard: true },
      ).pipe(
        Effect.andThen(
          Effect.forEach(open, ([, done]) => Deferred.await(done), {
            discard: true,
          }),
        ),
        Effect.timeoutOption(Duration.millis(drainWindowMs)),
      );
    });

    const frames = (connection: SsePushConnection) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const drain = yield* Deferred.make<void>();
          const done = yield* Deferred.make<void>();
          const ending = yield* Ref.make<Ending | undefined>(undefined);
          const now = yield* Clock.currentTimeMillis;

          live.set(drain, done);
          yield* Metric.update(pushOpened, 1);
          yield* Metric.update(pushConnections, live.size);

          const drained = Effect.as(Deferred.await(drain), 'drain' as const);
          const closing: Effect.Effect<Ending> =
            connection.expiresAt === undefined
              ? drained
              : Effect.raceFirst(
                  Effect.as(
                    Effect.sleep(
                      Duration.millis(
                        Math.max(
                          0,
                          connection.expiresAt * 1000 - reauthMarginMs - now,
                        ),
                      ),
                    ),
                    'reauth' as const,
                  ),
                  drained,
                );

          const messages = Stream.filter(
            Stream.mapEffect(push.open(connection), frameOf),
            (frame): frame is string => frame !== undefined,
          );
          const heartbeat = Stream.fromEffectRepeat(
            Effect.as(Effect.sleep(PUSH_HEARTBEAT), ': heartbeat\n\n'),
          );

          // The opening frame is sent at once: a chunked response writes its
          // headers with its first chunk, so a quiet stream would otherwise
          // leave the browser in `CONNECTING`.
          const body = Stream.concat(
            Stream.make(`retry: ${retry()}\n: open\n\n`),
            Stream.merge(messages, heartbeat, { haltStrategy: 'left' }),
          );

          const bounded = Stream.interruptWhen(
            body,
            Effect.flatMap(closing, reason => Ref.set(ending, reason)),
          );

          const last = Stream.unwrap(
            Effect.map(Ref.get(ending), reason => {
              switch (reason) {
                case 'reauth':
                  return Stream.fromEffect(
                    Effect.as(
                      Metric.update(pushReauth, 1),
                      'event: reauth\ndata: {}\n\n',
                    ),
                  );
                case 'drain':
                  return Stream.fromEffect(
                    Effect.as(
                      Metric.update(pushDrained, 1),
                      `retry: ${retry()}\n\n`,
                    ),
                  );
                default:
                  return Stream.empty;
              }
            }),
          );

          return Stream.ensuring(
            Stream.concat(bounded, last),
            Effect.suspend(() => {
              live.delete(drain);
              return Effect.all([
                Metric.update(pushClosed, 1),
                Metric.update(pushConnections, live.size),
                Deferred.succeed(done, undefined),
              ]);
            }),
          );
        }),
      );

    return {
      respond: connection =>
        HttpServerResponse.stream(
          Stream.map(frames(connection), frame => encoder.encode(frame)),
          {
            contentType: 'text/event-stream',
            headers: {
              // Scoped to one principal: a cached stream is served to whoever
              // asks next.
              'cache-control': 'no-store',
              connection: 'keep-alive',
              // A buffering proxy would hold every frame until the stream
              // ends — that is, forever.
              'x-accel-buffering': 'no',
            },
          },
        ),
    };
  });
