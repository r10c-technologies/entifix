import { Context, Effect, Option } from 'effect';

/**
 * The header a request's remaining budget travels in, as whole milliseconds
 * ([ADR 0014](../../../../../docs/adr/0014-retry-once-at-the-layer-above-under-a-budget.md)).
 *
 * A remainder rather than a timestamp, for the reason gRPC's `grpc-timeout`
 * is one: two hosts' clocks need not agree, and a skewed absolute deadline is
 * either already past or never reached.
 */
export const DEADLINE_HEADER = 'x-request-timeout-ms';

/** When the caller stops waiting, as epoch milliseconds on this host's clock. */
export interface Deadline {
  readonly expiresAt: number;
}

/**
 * The request's deadline, provided by the shell per request. Absent means no
 * caller named one; nothing below may invent it.
 */
export class DeadlineTag extends Context.Service<DeadlineTag, Deadline>()(
  '@entifix/core/Deadline',
) {}

/**
 * The deadline a header names, read against `now`. A value that is not a
 * non-negative integer is no deadline at all rather than an immediate one: a
 * malformed header must not turn every request into a timeout.
 */
export const deadlineFromHeader = (
  value: string | undefined,
  now: number,
): Deadline | undefined => {
  if (value === undefined || !/^\d+$/.test(value.trim())) return undefined;
  return { expiresAt: now + Number(value.trim()) };
};

/** Milliseconds left before `deadline`, never negative. */
export const remainingMs = (deadline: Deadline, now: number): number =>
  Math.max(0, deadline.expiresAt - now);

/** The current request's remaining milliseconds, or `undefined` with no deadline. */
export const currentRemainingMs: Effect.Effect<number | undefined> = Effect.gen(
  function* () {
    const deadline = yield* Effect.serviceOption(DeadlineTag);
    if (Option.isNone(deadline)) return undefined;
    const now = yield* Effect.clockWith(clock => clock.currentTimeMillis);
    return remainingMs(deadline.value, now);
  },
);
