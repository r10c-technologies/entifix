import { Effect, Layer } from 'effect';

import {
  DEFAULT_RETRY_DIALS,
  type RetryBudget,
  RetryBudgetTag,
  type RetryDials,
  type RetryKey,
} from '../ports/retry-budget.js';

interface Bucket {
  /** Retry tokens available. */
  tokens: number;
  /** When the floor last refilled, epoch ms. */
  refilledAt: number;
  /** Adaptive throttling's window: request and accept timestamps. */
  requests: number[];
  accepts: number[];
}

/** Requests the window must hold before throttling reads anything into it. */
export const MIN_THROTTLING_SAMPLE = 10;

const keyOf = (key: RetryKey) =>
  `${key.dependency}\u0000${key.organizationId ?? ''}`;

export interface InMemoryRetryBudgetOptions {
  readonly dials?: Partial<RetryDials>;
  /** The clock, in epoch milliseconds. Injected so a spec can move time. */
  readonly now?: () => number;
  /** A uniform draw in [0, 1). Injected so a spec can pin throttling. */
  readonly random?: () => number;
}

/**
 * A token-bucket retry budget held in this process
 * ([ADR 0014](../../../../../docs/adr/0014-retry-once-at-the-layer-above-under-a-budget.md)).
 *
 * Each first attempt adds `budgetRatio` of a token, so retries can add at most
 * that fraction to the dependency's load; the floor refills
 * `budgetFloorPerSecond` tokens a second regardless, so a quiet dependency can
 * still retry. Tokens are capped at what the floor plus ten seconds of ratio
 * would earn, so a long calm does not bank a stampede.
 *
 * Adaptive throttling is the SRE book's client-side rule: past `K` requests
 * per accept over the window, a first attempt is rejected locally with
 * probability `(requests − K·accepts) / (requests + 1)` — once the window holds
 * {@link MIN_THROTTLING_SAMPLE} requests, so a cold start is not throttled.
 *
 * One process, one budget: replicas do not share it, which is the point — a
 * replica's retries are its own load on the dependency.
 */
export const makeInMemoryRetryBudget = (
  options: InMemoryRetryBudgetOptions = {},
): RetryBudget => {
  const dials: RetryDials = { ...DEFAULT_RETRY_DIALS, ...options.dials };
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const buckets = new Map<string, Bucket>();
  const cap = Math.max(1, dials.budgetFloorPerSecond * 10);

  const bucketFor = (key: RetryKey): Bucket => {
    const id = keyOf(key);
    let bucket = buckets.get(id);
    if (bucket === undefined) {
      // One second's floor up front, so a dependency's very first failure can
      // be retried.
      bucket = {
        tokens: dials.budgetFloorPerSecond,
        refilledAt: now(),
        requests: [],
        accepts: [],
      };
      buckets.set(id, bucket);
    }
    const at = now();
    const elapsedSeconds = (at - bucket.refilledAt) / 1000;
    bucket.tokens = Math.min(
      cap,
      bucket.tokens + elapsedSeconds * dials.budgetFloorPerSecond,
    );
    bucket.refilledAt = at;
    const horizon = at - dials.adaptiveThrottlingWindowMs;
    bucket.requests = bucket.requests.filter(t => t > horizon);
    bucket.accepts = bucket.accepts.filter(t => t > horizon);
    return bucket;
  };

  return {
    dials,
    admitAttempt: key =>
      Effect.sync(() => {
        const bucket = bucketFor(key);
        bucket.requests.push(now());
        bucket.tokens = Math.min(cap, bucket.tokens + dials.budgetRatio);
        if (dials.adaptiveThrottlingK <= 0) return true;
        const requests = bucket.requests.length;
        // Too few requests to say anything: a cold dependency, or one just
        // coming back, would otherwise throttle half its first calls before a
        // single answer had a chance to arrive.
        if (requests < MIN_THROTTLING_SAMPLE) return true;
        const rejection = Math.max(
          0,
          (requests - dials.adaptiveThrottlingK * bucket.accepts.length) /
            (requests + 1),
        );
        return random() >= rejection;
      }),
    admitRetry: key =>
      Effect.sync(() => {
        const bucket = bucketFor(key);
        if (bucket.tokens < 1) return false;
        bucket.tokens -= 1;
        return true;
      }),
    recordAccepted: key =>
      Effect.sync(() => {
        bucketFor(key).accepts.push(now());
      }),
  };
};

/** The in-memory budget as a layer, for a host's composition root. */
export const InMemoryRetryBudgetLayer = (
  options: InMemoryRetryBudgetOptions = {},
) => Layer.sync(RetryBudgetTag, () => makeInMemoryRetryBudget(options));
