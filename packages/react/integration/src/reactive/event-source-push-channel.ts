import { decodeEvent, type DomainEvent } from '@entifix/core';
import { Effect, Result, Schema } from 'effect';

import type { PushChannel } from './push-channel.js';
import { makePushRouter } from './push-router.js';

/** The stream URL's repeated parameter naming one subscribed topic. */
export const PUSH_TOPIC_PARAM = 'topic';
/** The stream URL's repeated parameter carrying one flow capability. */
export const PUSH_CAPABILITY_PARAM = 'capability';
/**
 * The stream URL's parameter carrying the last event id seen, on a reopen. A
 * new `EventSource` cannot set the `Last-Event-ID` header itself.
 */
export const PUSH_CURSOR_PARAM = 'lastEventId';

export interface EventSourcePushChannelOptions {
  /** The stream's same-origin URL, without the topic parameters. */
  readonly url: string;
  /**
   * Refreshes the session when the server asks for a reauth. The stream stays
   * closed until it resolves; a rejection leaves it closed until the next
   * change of interest, because reopening on a credential known to be dead is
   * a `401`, which an `EventSource` never retries.
   */
  readonly refresh: () => Promise<void>;
  /**
   * The flow capabilities to present, read at every open. A host that hands
   * an anonymous holder a capability returns it here.
   */
  readonly capabilities?: () => readonly string[];
  /**
   * How long a change of interest waits before reopening, in milliseconds, so
   * a screen mounting five subscriptions reopens once. Defaults to 25.
   */
  readonly reopenDelayMs?: number;
}

export interface EventSourcePushChannel extends PushChannel {
  /**
   * How many frames this channel dropped because they did not decode. A frame
   * is dropped rather than thrown, so the count is the only trace a drifted
   * server leaves in the browser.
   */
  dropped(): number;
}

const EventFrame = Schema.Struct({
  topics: Schema.Array(Schema.String),
  envelope: Schema.Unknown,
});

const ResyncFrame = Schema.Struct({ topics: Schema.Array(Schema.String) });

const parse = <A>(
  raw: string,
  decode: (body: unknown) => Effect.Effect<A, unknown>,
): Result.Result<A, unknown> =>
  Effect.runSync(
    Effect.result(
      Effect.flatMap(
        Effect.try(() => JSON.parse(raw) as unknown),
        decode,
      ),
    ),
  );

const decodeEventFrame = (
  body: unknown,
): Effect.Effect<
  { readonly topics: readonly string[]; readonly event: DomainEvent },
  unknown
> =>
  Effect.flatMap(Schema.decodeUnknownEffect(EventFrame)(body), frame =>
    Effect.map(decodeEvent(frame.envelope), event => ({
      topics: frame.topics,
      event,
    })),
  );

/**
 * The push channel's browser end: **one** `EventSource` per tab per base URL,
 * multiplexing every subscribed topic
 * ([ADR 0021](../../../../../docs/adr/0021-server-push-and-the-multiplexed-channel.md)).
 *
 * The topic set is the stream's URL, so a change of interest closes the stream
 * and opens a new one, carrying the last event id so the server can resume.
 * The reopen is debounced; a stream nobody listens to is closed on the same
 * delay. Every frame is decoded through the message registry, and one that
 * does not decode is dropped and counted.
 *
 * On `event: reauth` the stream is closed at once — before the server's EOF
 * could make the browser reconnect on the expiring cookie — and reopened only
 * once `refresh` resolves.
 */
export function makeEventSourcePushChannel({
  url,
  refresh,
  capabilities = () => [],
  reopenDelayMs = 25,
}: EventSourcePushChannelOptions): EventSourcePushChannel {
  const router = makePushRouter();
  let source: EventSource | undefined;
  let openedUrl: string | undefined;
  let lastEventId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refreshing = false;
  let dropped = 0;

  const streamUrl = (): string | undefined => {
    const topics = router.topics();
    if (topics.length === 0) return undefined;
    const params = new URLSearchParams();
    for (const topic of topics) params.append(PUSH_TOPIC_PARAM, topic);
    for (const capability of [...capabilities()].sort())
      params.append(PUSH_CAPABILITY_PARAM, capability);
    return `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
  };

  const close = (): void => {
    source?.close();
    source = undefined;
    openedUrl = undefined;
    router.disconnected();
  };

  const open = (target: string): void => {
    const cursor =
      lastEventId === undefined
        ? ''
        : `&${PUSH_CURSOR_PARAM}=${encodeURIComponent(lastEventId)}`;
    const opened = new EventSource(`${target}${cursor}`);
    source = opened;
    openedUrl = target;
    opened.onopen = () => {
      router.connected();
    };
    // A dropped stream: the browser retries on its own while the source is
    // `CONNECTING`, and has given up once it is `CLOSED`.
    opened.onerror = () => {
      router.disconnected(
        opened.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting',
      );
    };
    opened.onmessage = message => {
      if (message.lastEventId !== '') lastEventId = message.lastEventId;
      const frame = parse(message.data as string, decodeEventFrame);
      if (Result.isFailure(frame)) {
        dropped += 1;
        return;
      }
      router.deliver(frame.success.topics, frame.success.event);
    };
    opened.addEventListener('resync', message => {
      const frame = parse(
        (message as MessageEvent).data as string,
        Schema.decodeUnknownEffect(ResyncFrame),
      );
      if (Result.isFailure(frame)) {
        dropped += 1;
        return;
      }
      router.resync(frame.success.topics);
    });
    opened.addEventListener('reauth', () => {
      close();
      refreshing = true;
      refresh().then(
        () => {
          refreshing = false;
          sync();
        },
        () => {
          refreshing = false;
        },
      );
    });
  };

  // Brings the stream in line with the subscribed topics: closes it when
  // nothing listens, reopens it when the topics or capabilities moved.
  const sync = (): void => {
    // Guarded because a server-rendered pass has no `EventSource` at all.
    if (refreshing || typeof EventSource === 'undefined') return;
    const target = streamUrl();
    if (target === openedUrl) return;
    close();
    if (target !== undefined) open(target);
  };

  router.onTopicsChange(() => {
    clearTimeout(timer);
    timer = setTimeout(sync, reopenDelayMs);
  });

  return {
    subscribe: router.subscribe,
    onConnect: router.onConnect,
    onResync: router.onResync,
    connection: router.connection,
    onConnectionChange: router.onConnectionChange,
    reconnect: () => {
      // Forgets the open stream, so the sync opens a fresh one at once.
      close();
      sync();
    },
    dropped: () => dropped,
  };
}
