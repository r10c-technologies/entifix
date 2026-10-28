import type { SubscriptionMode } from '@entifix/transactions';
import { Metric } from 'effect';

/**
 * The bus half of the framework's first metric set; the outbox half is in
 * `@entifix/mongo`.
 *
 * Counters rather than logs because a quarantined message that is only ever a
 * log line is indistinguishable from a dropped one when the question is *how
 * many*. Nothing here needs plumbing: `NodeSdk` wires the metric reader through
 * `@effect/opentelemetry`'s `Metrics.layer`, whose producer reads **Effect's own
 * global registry**, so an increment in any fiber — including the detached one
 * the AMQP consumer settles a delivery in — is exported.
 */

/**
 * ⚠️ These metric objects are **exported so a reader uses the same instance**.
 * An Effect metric's registry key includes its description, so
 * `Metric.counter('bus_events_published_total')` written out again — without the
 * description — addresses a *different* series that is always zero. That is a
 * silent way to write a dashboard query against nothing.
 */

/** Events handed to the broker, by event name. */
export const busEventsPublished = Metric.counter('bus_events_published_total', {
  description: 'Events accepted by the broker, by event name.',
});

/**
 * Publishes the broker refused, by event name.
 *
 * Separate from the outbox's own failure count on purpose: this one says the
 * broker would not take it, the outbox's says how many attempts that entry has
 * spent. One is a rate, the other is a backlog.
 */
export const busPublishFailures = Metric.counter('bus_publish_failures_total', {
  description: 'Publishes the broker refused, by event name.',
});

/** Deliveries whose handler completed and were acked, by subscription. */
export const busEventsConsumed = Metric.counter('bus_events_consumed_total', {
  description: 'Deliveries acked after their handler completed.',
});

/**
 * Deliveries that failed, by subscription and failure class.
 *
 * Every failed delivery, including the ones that go on to be retried, so a
 * transient failure on its fifth attempt is counted here exactly like its
 * first. How many messages were finally given up on is
 * {@link busEventsQuarantined}.
 */
export const busEventsFailed = Metric.counter('bus_events_failed_total', {
  description:
    'Deliveries whose handler or payload failed, by subscription and ' +
    'failure class, retried or not.',
});

/**
 * Messages moved to `<queue>.quarantine`, by subscription and failure category.
 *
 * Possible since the adapter, not the broker, decides the ceiling (#130): every
 * quarantine now goes through one call site in the adapter, so this is the
 * dead-letter count `bus_events_failed_total` could never be. A poison message
 * is counted on its first delivery, and a transient one when it has spent its
 * subscription's `maxAttempts`. A redelivery the broker dead-letters after a
 * consumer crash (`x-delivery-limit`) still bypasses the adapter, so the
 * quarantine queue's depth stays the confirmation.
 */
export const busEventsQuarantined = Metric.counter(
  'bus_events_quarantined_total',
  {
    description:
      'Messages the adapter moved to a quarantine queue, by subscription ' +
      'and failure category.',
  },
);

/**
 * Identity of a subscription, as metric tags.
 *
 * `queue` is the durable work-queue name and so the only stable identity a
 * broadcast subscription does *not* have — its queue is anonymous and
 * regenerated per connection — which is why `slice` and `mode` are carried
 * beside it rather than derived from it.
 */
export interface SubscriptionTags {
  queue: string;
  slice: string;
  mode: SubscriptionMode;
}

const withSubscription = (
  metric: Metric.Counter<number>,
  tags: SubscriptionTags,
) =>
  metric.pipe(
    Metric.withAttributes({ queue: tags.queue }),
    Metric.withAttributes({ slice: tags.slice }),
    Metric.withAttributes({ mode: tags.mode }),
  );

/** Record one event accepted by the broker. */
export const recordPublished = (eventName: string) =>
  Metric.update(
    Metric.withAttributes(busEventsPublished, { event: eventName }),
    1,
  );

/** Record one publish the broker refused. */
export const recordPublishFailure = (eventName: string) =>
  Metric.update(
    Metric.withAttributes(busPublishFailures, { event: eventName }),
    1,
  );

/** Record one delivery acked after its handler completed. */
export const recordConsumed = (tags: SubscriptionTags) =>
  Metric.update(withSubscription(busEventsConsumed, tags), 1);

/**
 * Record one nacked delivery.
 *
 * `failure` is the class, never the event name: a poison message by definition
 * could not be parsed, so it has no `event.name` to attribute it to, and
 * dimensioning only the arm that has one would make the two counts
 * incomparable.
 */
export const recordFailed = (
  tags: SubscriptionTags,
  failure: 'transient' | 'poison',
) =>
  Metric.update(
    Metric.withAttributes(withSubscription(busEventsFailed, tags), { failure }),
    1,
  );

/**
 * Record one message moved to its quarantine queue.
 *
 * `category` rather than `code`: the categories are a closed set and the codes
 * are not, and a metric attribute with an open set of values is a series per
 * typo.
 */
export const recordQuarantined = (tags: SubscriptionTags, category: string) =>
  Metric.update(
    Metric.withAttributes(withSubscription(busEventsQuarantined, tags), {
      category,
    }),
    1,
  );
