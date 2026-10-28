import { Context, type Effect, Metric } from 'effect';

/**
 * Which budget a retry draws from: one per dependency, and per organization
 * when the call acts for one, so a single tenant's outage cannot spend the
 * retries every other tenant needs
 * ([ADR 0014](../../../../../docs/adr/0014-retry-once-at-the-layer-above-under-a-budget.md)).
 */
export interface RetryKey {
  readonly dependency: string;
  readonly organizationId?: string;
}

/** The dials, with ADR 0014's defaults in {@link DEFAULT_RETRY_DIALS}. */
export interface RetryDials {
  /** Attempts per call, the first included. */
  readonly maxAttempts: number;
  /** Retries may add at most this fraction to a dependency's first attempts. */
  readonly budgetRatio: number;
  /** Retries admitted per second regardless of the ratio. */
  readonly budgetFloorPerSecond: number;
  readonly backoffBaseMs: number;
  readonly backoffCapMs: number;
  /** Client-side throttling multiplier; `0` turns it off. */
  readonly adaptiveThrottlingK: number;
  readonly adaptiveThrottlingWindowMs: number;
}

export const DEFAULT_RETRY_DIALS: RetryDials = {
  maxAttempts: 3,
  budgetRatio: 0.1,
  budgetFloorPerSecond: 1,
  backoffBaseMs: 50,
  backoffCapMs: 2000,
  adaptiveThrottlingK: 2,
  adaptiveThrottlingWindowMs: 120_000,
};

/**
 * The budget every in-process retry draws from. The port is here, in `.`, so
 * anything that orchestrates calls can reach it; the engine is at `/engine`,
 * where a cell cannot import it.
 */
export interface RetryBudget {
  readonly dials: RetryDials;
  /** A first attempt is about to be made. Returns `false` to throttle it locally. */
  readonly admitAttempt: (key: RetryKey) => Effect.Effect<boolean>;
  /** A retry wants to run. Returns `false` when the budget is spent. */
  readonly admitRetry: (key: RetryKey) => Effect.Effect<boolean>;
  /** The dependency answered — an answer, even a refusal, counts as accepted. */
  readonly recordAccepted: (key: RetryKey) => Effect.Effect<void>;
}

export class RetryBudgetTag extends Context.Service<
  RetryBudgetTag,
  RetryBudget
>()('@entifix/transactions/RetryBudget') {}

/** Retries started, by dependency. */
export const retryAttempts = Metric.counter('entifix_retry_attempts_total', {
  description: 'In-process retries started, by dependency.',
});

/** Retries the budget refused, by dependency. */
export const retryBudgetRejections = Metric.counter(
  'entifix_retry_budget_rejections_total',
  {
    description: 'Retries refused because the budget was spent, by dependency.',
  },
);

/** First attempts throttled locally by adaptive throttling, by dependency. */
export const retryThrottled = Metric.counter('entifix_retry_throttled_total', {
  description: 'First attempts rejected locally by adaptive throttling.',
});
