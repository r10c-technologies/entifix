import type { WiringRegistry } from '@entifix/business';
import { ShutdownRegistryTag, WiringRegistryTag } from '@entifix/business';
import {
  isFailure,
  makeEventEnvelope,
  readEventEnvelope,
  Unavailable,
} from '@entifix/core';
import {
  type EventBus,
  EventBusTag,
  type Subscription,
} from '@entifix/transactions';
import type { Channel, ConsumeMessage } from 'amqplib';
import { Context, Duration, Effect, Layer, Option } from 'effect';

import {
  AmqpChannelTag,
  type AmqpConnector,
  EVENTS_DLX,
  EVENTS_EXCHANGE,
} from '../amqp-connection/amqp-connection.js';
import {
  recordConsumed,
  recordFailed,
  recordPublished,
  recordPublishFailure,
  recordQuarantined,
  type SubscriptionTags,
} from './bus-metrics.js';

/** Appended to a work queue's name to make the queue that holds its failures. */
const QUARANTINE_SUFFIX = '.quarantine';

/**
 * How often the shutdown drain re-checks whether the handlers have finished.
 *
 * A poll rather than a latch because a delivery is started from amqplib's own
 * callback, outside any fiber this module holds; the drain's own bound is the
 * shutdown hook's, so this interval only decides how promptly the process
 * notices it is free to go.
 */
const DELIVERY_POLL = Duration.millis(25);

/**
 * Why a delivery did not succeed, which is the whole of the nack decision.
 *
 * `transient` is a handler that threw — a dependency briefly gone, a timeout —
 * and is worth another delivery. `poison` is a payload this process cannot
 * read, and is worth **none**: a message that cannot be deserialized never
 * becomes deserializable, so retrying it only spends the delivery budget of the
 * messages queued behind it. Conflating the two is what the adapter once did,
 * on a queue that discarded both.
 *
 * A *business* failure is neither, and never reaches here: that message was
 * handled successfully and produced its own `failed` event.
 */
interface DeliveryFailure {
  readonly kind: 'transient' | 'poison';
  /** The failure's code and category, carried onto a quarantined message. */
  readonly code: string;
  readonly category: string;
}

/**
 * The poison rule, by category and never by class
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)):
 * an answer redelivered is the same answer, so every business failure is
 * poison, and so is `protocol` — bytes that did not decode will not decode on
 * the fifth try. The transient categories are redelivered, bounded by the
 * subscription's `maxAttempts` as the adapter counts them, and so is anything
 * uncategorised: not knowing what went wrong is not evidence that retrying is
 * pointless.
 */
const classify = (error: unknown): DeliveryFailure =>
  isFailure(error)
    ? {
        kind:
          error.family === 'business' || error.category === 'protocol'
            ? 'poison'
            : 'transient',
        code: error.code,
        category: error.category,
      }
    : { kind: 'transient', code: 'internal', category: 'internal' };

/** A payload that is not JSON: the sender's fault, decided before any handler. */
const UNREADABLE: DeliveryFailure = {
  kind: 'poison',
  code: 'invalidEnvelope',
  category: 'invalid',
};

/**
 * The queue a subscription binds.
 *
 * `<subscribing slice>.<pattern>`, so the name says who is owed the messages in
 * it — readable in the broker's own UI, which is where someone looks when a
 * queue has depth. The slice is the *subscriber's*, never the publisher's:
 * `EventSourceTag` names the emitter, and one deployment hosts several slices
 * (a host may co-deploy two slices in one process), so
 * deriving from it would file a consumer's queue under whoever happened to
 * publish from the same process.
 *
 * `*` and `#` are spelled out because AMQP 0-9-1 restricts a queue name to
 * letters, digits, hyphen, underscore, period and colon. RabbitMQ is lenient in
 * practice, but the name also has to survive being a URL path segment in the
 * management API, and `%2A` in an operator's address bar is a poor trade for
 * three saved characters.
 */
export const queueNameFor = (subscription: Subscription): string =>
  `${subscription.slice}.${subscription.pattern
    .replaceAll('*', '_star_')
    .replaceAll('#', '_hash_')}`;

/**
 * Declares the queue a subscription consumes and returns its name.
 *
 * A **work** queue is durable and quorum-backed, so it survives the consumer's
 * restart and accumulates while it is gone — the hop the outbox relay's
 * durability chain was missing. Its retry ceiling is the subscription's
 * `maxAttempts`, counted by the adapter in {@link ATTEMPTS_HEADER} because the
 * broker does not count a requeued nack (#130). The same number is the queue's
 * `x-delivery-limit`, which bounds what the broker *does* count — a redelivery
 * after a consumer crash.
 *
 * The quarantine is declared **first**: a message dead-lettered the instant the
 * work queue exists must have somewhere to land, and a `direct` exchange with
 * no matching binding drops what it routes.
 *
 * `x-delivery-limit` is immutable once a queue exists. Re-declaring with a
 * different `maxAttempts` fails `PRECONDITION_FAILED` and closes the channel,
 * and there is no safe automatic recovery — so changing the ceiling means
 * deleting the queue, which locally is `pnpm run <app>:dev:reset`.
 */
const declareQueue = async (
  channel: Channel,
  subscription: Subscription,
): Promise<string> => {
  if (subscription.mode === 'broadcast') {
    // Connection-scoped and retained by nobody, which is right only when the
    // replicas differ from one another, as a per-connection push does.
    const { queue } = await channel.assertQueue('', { exclusive: true });
    return queue;
  }

  const queue = queueNameFor(subscription);
  const quarantine = `${queue}${QUARANTINE_SUFFIX}`;

  await channel.assertQueue(quarantine, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await channel.bindQueue(quarantine, EVENTS_DLX, queue);
  await channel.assertQueue(queue, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': subscription.maxAttempts,
      'x-dead-letter-exchange': EVENTS_DLX,
      'x-dead-letter-routing-key': queue,
    },
  });

  return queue;
};

/**
 * The adapter's own count of the attempts a message has failed, carried on the
 * copy it republishes (#130).
 *
 * The broker cannot be trusted with it. RabbitMQ 4 does not count a requeued
 * `basic.nack` toward a quorum queue's `x-delivery-limit` — measured on 4.3.5:
 * a queue limited to 2 delivered one message 8 times and never set
 * `x-delivery-count` — so a transient failure that never cleared was
 * redelivered without a ceiling and without a pause. `x-delivery-limit` stays
 * on the queue, where it still bounds the redeliveries a crashed consumer
 * causes, which the broker does count.
 */
export const ATTEMPTS_HEADER = 'x-entifix-attempts';

const attemptsSoFar = (message: ConsumeMessage): number => {
  const value: unknown = message.properties?.headers?.[ATTEMPTS_HEADER];
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : 0;
};

/** How long a transient failure waits before its copy goes back on the queue. */
export type RedeliveryBackoff = (attempt: number) => Duration.Duration;

/**
 * A backoff doubling from `baseMs`, capped at `capMs`. The wait holds the
 * delivery — the queue is `prefetch(1)`, so it pauses this consumer — which is
 * the point: a dependency that is down is not helped by asking it again at
 * once.
 */
export const exponentialRedeliveryBackoff =
  (dials: {
    readonly baseMs: number;
    readonly capMs: number;
  }): RedeliveryBackoff =>
  attempt =>
    Duration.millis(Math.min(dials.baseMs * 2 ** (attempt - 1), dials.capMs));

/** Doubling from 100 ms, capped at two seconds. */
export const DEFAULT_REDELIVERY_BACKOFF: RedeliveryBackoff =
  exponentialRedeliveryBackoff({ baseMs: 100, capMs: 2_000 });

/**
 * The redelivery backoff {@link AmqpEventBusLayer} uses, when a composition
 * provides one; {@link DEFAULT_REDELIVERY_BACKOFF} otherwise.
 *
 * A tag rather than a layer option because the dials it is sized from are
 * runtime configuration a host reads at boot, after the layer value already
 * exists. Read with `Effect.serviceOption`, so a host that never sizes it
 * provides nothing — which also means nothing forces one that meant to, and
 * the spec pins both arms.
 */
export class RedeliveryBackoffTag extends Context.Service<
  RedeliveryBackoffTag,
  RedeliveryBackoff
>()('RedeliveryBackoffTag') {}

/**
 * Settles a delivery that failed.
 *
 * Poison on a `work` queue — and a transient failure that has spent the
 * subscription's `maxAttempts` — is republished to the dead-letter exchange
 * **with its reason**: `x-failure-code`, `x-failure-category` and the attempts
 * spent. It is then acked rather than nacked, because a nack cannot carry
 * headers, and a quarantine of messages nobody can say anything about is a
 * queue an operator has to replay blind. If that publish is refused the nack
 * still quarantines it, reasonless.
 *
 * A transient failure under the ceiling waits its backoff, goes back on its own
 * queue as a copy carrying the attempt count, and the original is acked. If
 * that publish is refused it is nacked for the broker to redeliver, which is
 * the old behaviour and still better than losing it. A `broadcast` queue has no
 * quarantine and no ceiling, so its failures are dropped.
 */
const settleFailure = (
  channel: Channel,
  message: ConsumeMessage,
  queue: string,
  subscription: Subscription,
  failure: DeliveryFailure,
  backoff: RedeliveryBackoff,
  tags: SubscriptionTags,
): Effect.Effect<void> => {
  if (subscription.mode === 'broadcast') {
    return Effect.sync(() => channel.nack(message, false, false));
  }
  const attempts =
    failure.kind === 'transient' ? attemptsSoFar(message) + 1 : 0;
  if (failure.kind === 'poison' || attempts >= subscription.maxAttempts) {
    return Effect.sync(() =>
      quarantine(channel, message, queue, failure, attempts),
    ).pipe(Effect.andThen(recordQuarantined(tags, failure.category)));
  }
  const wait = backoff(attempts);
  return (Duration.isZero(wait) ? Effect.void : Effect.sleep(wait)).pipe(
    Effect.andThen(
      Effect.sync(() => {
        try {
          channel.publish('', queue, message.content, {
            ...message.properties,
            persistent: true,
            headers: {
              ...message.properties?.headers,
              [ATTEMPTS_HEADER]: attempts,
            },
          });
          channel.ack(message);
        } catch {
          channel.nack(message, false, true);
        }
      }),
    ),
  );
};

const quarantine = (
  channel: Channel,
  message: ConsumeMessage,
  queue: string,
  failure: DeliveryFailure,
  attempts: number,
): void => {
  try {
    channel.publish(EVENTS_DLX, queue, message.content, {
      ...message.properties,
      persistent: true,
      headers: {
        ...message.properties?.headers,
        'x-failure-code': failure.code,
        'x-failure-category': failure.category,
        ...(attempts > 0 ? { [ATTEMPTS_HEADER]: attempts } : {}),
      },
    });
    channel.ack(message);
  } catch {
    // Quarantined without its reason beats not quarantined.
    channel.nack(message, false, false);
  }
};

/**
 * RabbitMQ-backed {@link EventBus}. Events go out as `event` envelopes on the
 * shared topic exchange — the adapter owns the wire framing, so the port stays
 * event-typed.
 *
 * **The event's own name is the routing key**, which is what lets a subscriber
 * bind the exact pattern it declared in `tools/slices/*.slice.ts`.
 *
 * The queue a subscriber binds is its own choice of shape. A `work`
 * subscription gets a named durable queue that replicas share and that keeps
 * accumulating while the consumer is down; a `broadcast` one gets an exclusive
 * queue, where every replica sees every event and nothing
 * survives a restart. Choosing broadcast for a workload that is work is how an
 * event published during a rollout is dropped by the broker while the outbox
 * has already recorded it sent.
 *
 * Both methods go through the {@link AmqpConnector} rather than holding a
 * channel, because a channel does not survive the broker restarting. `publish`
 * asks for a live one per call, and `subscribe` registers its setup so the
 * connector can re-run it against the new channel after a reconnect. A durable
 * queue outlives that reconnect; the consumer bound to it does not.
 *
 * It returns the bus **and** its `drainDeliveries`, rather than only the port:
 * waiting for in-flight handlers is an adapter fact — it is this module that
 * runs them — and putting it on `EventBus` would make every implementation of
 * a framework-free port carry a shutdown concern it has no deliveries to drain.
 */
export const makeAmqpEventBus = (
  connector: AmqpConnector,
  wiring: WiringRegistry,
  options: { readonly redeliveryBackoff?: RedeliveryBackoff } = {},
): { bus: EventBus; drainDeliveries: Effect.Effect<void> } => {
  const backoff = options.redeliveryBackoff ?? DEFAULT_REDELIVERY_BACKOFF;
  /**
   * Handlers started and not yet settled.
   *
   * Nothing tracked them before, so a SIGTERM killed them mid-flight and the
   * broker redelivered whatever was unacked — safe only while every consumer
   * happens to be idempotent, which is the assumption the command inbox stops
   * making.
   */
  let inFlight = 0;

  const bus: EventBus = {
    publish: event =>
      Effect.tryPromise({
        try: () =>
          connector.withChannel(async channel => {
            channel.publish(
              EVENTS_EXCHANGE,
              event.name,
              Buffer.from(JSON.stringify(makeEventEnvelope(event))),
              { persistent: true },
            );
          }),
        catch: error => new Unavailable({ dependency: 'amqp' }),
        // Recorded **after** the publish succeeds, so `GET /api/$service` reports
        // what this process actually put on the exchange. Recording the intent
        // instead would make the declared-vs-observed diff pass on a service whose
        // every publish is failing.
      }).pipe(
        Effect.tap(() =>
          wiring
            .recordPublish(event.name)
            .pipe(Effect.andThen(recordPublished(event.name))),
        ),
        // Counted here and not in the `catch` above, which only builds the
        // error: a rising publish-failure rate against a flat published rate
        // is what a broker outage looks like from the publisher's side, and
        // the outbox's own backlog is the confirmation.
        Effect.tapError(() => recordPublishFailure(event.name)),
      ),

    subscribe: (subscription, handler) =>
      Effect.tryPromise({
        try: () =>
          connector.addConsumer(async channel => {
            // One unacked message at a time: events for a transaction are then
            // folded serially (never concurrently), so an `accepted`/`completed`
            // pair can't race into two upserts.
            await channel.prefetch(1);
            const queue = await declareQueue(channel, subscription);
            await channel.bindQueue(
              queue,
              EVENTS_EXCHANGE,
              subscription.pattern,
            );
            // What the process **bound**, recorded at the point it bound it. The
            // registry deduplicates, so re-running this setup after a reconnect
            // does not double the entry.
            await Effect.runPromise(
              wiring.recordSubscription({
                slice: subscription.slice,
                pattern: subscription.pattern,
                mode: subscription.mode,
                queue,
              }),
            );
            // Resolved once per binding rather than per delivery: `queue` is the
            // durable name for a `work` subscription and the broker's generated
            // one for a `broadcast` queue, so it is only knowable here.
            const tags: SubscriptionTags = {
              queue,
              slice: subscription.slice,
              mode: subscription.mode,
            };
            const { consumerTag } = await channel.consume(
              queue,
              (message: ConsumeMessage | null) => {
                if (message === null) {
                  return;
                }

                // Reading the payload and running the handler are separated on
                // purpose: they fail for different reasons and earn different
                // treatment. `JSON.parse` is inside the Effect because it throws
                // *synchronously* — outside, it escaped into amqplib's callback and
                // the message was never even nacked.
                const settle = Effect.try({
                  try: () => JSON.parse(message.content.toString()) as unknown,
                  catch: (): DeliveryFailure => UNREADABLE,
                }).pipe(
                  Effect.flatMap(parsed =>
                    readEventEnvelope(parsed).pipe(Effect.mapError(classify)),
                  ),
                  // The handler carries no requirements (the subscriber closes over
                  // its store), so it runs standalone.
                  //
                  // ⚠️ A handler's failure is classified by its category, not
                  // treated as transient across the board. The transport
                  // validates `meta` and deliberately not `data` (inventing an
                  // opinion about a payload is how the bus would start knowing
                  // about domains), so a consumer that decodes its own payload
                  // is the *only* thing that can tell a malformed one from a bad
                  // afternoon at the database — and it says so by failing with
                  // a business or `protocol` failure, which quarantines at once
                  // instead of spending `maxAttempts` on every message
                  // behind it. Measured on `catalog.published`: a payload the
                  // contract rejected used to take five deliveries to quarantine.
                  Effect.flatMap(event =>
                    handler(event).pipe(Effect.mapError(classify)),
                  ),
                );

                // Counted around the whole settle, so a shutdown waits for the ack
                // as well as the handler: cancelling a consumer stops *new*
                // deliveries and says nothing about this one.
                inFlight += 1;
                void Effect.runPromise(
                  settle.pipe(
                    // Effect's metric registry is a process-wide singleton, so an
                    // increment inside this detached `runPromise` reaches the same
                    // producer `NodeSdk` exports from. That is the only reason a
                    // metric works here at all — nothing about this fiber is
                    // inside the observability layer.
                    Effect.matchEffect({
                      onSuccess: () =>
                        recordConsumed(tags).pipe(
                          Effect.andThen(
                            Effect.sync(() => channel.ack(message)),
                          ),
                        ),
                      onFailure: failure =>
                        recordFailed(tags, failure.kind).pipe(
                          Effect.andThen(
                            settleFailure(
                              channel,
                              message,
                              queue,
                              subscription,
                              failure,
                              backoff,
                              tags,
                            ),
                          ),
                        ),
                    }),
                  ),
                ).finally(() => {
                  inFlight -= 1;
                });
              },
            );
            return [consumerTag];
          }),
        catch: error => new Unavailable({ dependency: 'amqp' }),
      }),
  };

  return {
    bus,
    drainDeliveries: Effect.gen(function* () {
      while (inFlight > 0) {
        yield* Effect.sleep(DELIVERY_POLL);
      }
    }),
  };
};

/**
 * Provides {@link EventBusTag} from an {@link AmqpChannelTag}.
 *
 * It also takes {@link WiringRegistryTag}, which `makeServerLayer` provides once
 * per service — so the bus and `GET /api/$service` share one instance, and the
 * document reports the bindings this very process made.
 */
export const AmqpEventBusLayer = Layer.effect(
  EventBusTag,
  Effect.gen(function* () {
    const connector = yield* AmqpChannelTag;
    const wiring = yield* WiringRegistryTag;
    const shutdown = yield* ShutdownRegistryTag;
    const redeliveryBackoff = yield* Effect.serviceOption(RedeliveryBackoffTag);
    const { bus, drainDeliveries } = makeAmqpEventBus(connector, wiring, {
      redeliveryBackoff: Option.getOrUndefined(redeliveryBackoff),
    });

    // `stop-intake`, and both halves are it: cancelling stops the broker
    // handing over anything new, then the drain waits for the deliveries
    // already in progress. Registered here rather than in a service's `main.ts`
    // for the reason every registry in this repo exists — a service that gains
    // a bus gains its drain, with nothing to remember.
    yield* shutdown.register({
      name: 'amqp-consumers',
      phase: 'stop-intake',
      run: Effect.promise(() => connector.cancelConsumers()).pipe(
        Effect.andThen(drainDeliveries),
      ),
    });

    return bus;
  }),
);
