import {
  ConfigurationClientInMemory,
  ConfigurationPlain,
  EntifixConnError,
} from '@entifix/core';
import { Context, Effect, Schedule } from 'effect';

/**
 * DI tag carrying the raw {@link ConfigurationPlain} a service loaded at boot,
 * so a `GET /api/config` introspection route can expose it (redacted).
 */
export class LoadedConfigurationTag extends Context.Service<
  LoadedConfigurationTag,
  ConfigurationPlain
>()('LoadedConfigurationTag') {}

/**
 * Default boot-fetch retry policy: 20 attempts spaced 1s apart (~20s window).
 *
 * A dependent service `dev` target `dependsOn config-service:dev`, but Nx
 * considers a *continuous* dependency "ready" the moment its process starts —
 * not when its HTTP server is listening and its table is seeded. So a fast
 * backend can fire its boot fetch before config-service answers and, without a
 * retry, would crash with `fetch failed` (connection refused). Retrying a
 * bounded window lets the fleet come up in any order.
 */
export const defaultConfigRetrySchedule: Schedule.Schedule<unknown, unknown> =
  Schedule.max([Schedule.spaced('1 seconds'), Schedule.recurs(20)]);

/**
 * Deadline for a single boot-fetch attempt.
 *
 * **The retry above only helps if an attempt can fail.** `fetch` has no timeout
 * of its own, so a connection that is accepted but never answered — a previous
 * listener dying mid-flight, a half-open socket — leaves it waiting forever.
 * The schedule never sees a failure, never retries, and the service hangs in its
 * boot layer with its port bound and nothing served: measured twice on
 * 2026-08-14, on two different services, and recovered only by recreating the
 * datastores.
 *
 * So an attempt is deadlined, for the same reason a readiness probe is: a check
 * that hangs is a check that failed. The ordinary race this retry was written
 * for — config-service not listening yet — still fails instantly with
 * `ECONNREFUSED` and costs nothing, so this bounds the pathological case only:
 * 20 retries × (5s deadline + 1s spacing) ≈ 2 minutes before the service exits
 * loudly instead of hanging silently.
 */
export const defaultConfigAttemptTimeoutMs = 5_000;

/** Options for {@link loadRemoteConfiguration}. */
export interface LoadRemoteConfigurationOptions {
  /**
   * Retry policy for the boot fetch. Defaults to
   * {@link defaultConfigRetrySchedule}. Pass `Schedule.stop` to fail fast (a
   * single attempt, no retry) — used by tests and callers that want the error
   * immediately.
   */
  readonly retrySchedule?: Schedule.Schedule<unknown, unknown>;
  /**
   * Deadline for one attempt, in milliseconds. Defaults to
   * {@link defaultConfigAttemptTimeoutMs}. There is deliberately no way to
   * disable it — an attempt that cannot time out is the bug this exists for.
   */
  readonly attemptTimeoutMs?: number;
}

/**
 * Where a service's configuration is fetched from, and what the request
 * carries.
 *
 * Both are the host's: the path a configuration service answers on and the
 * credential it asks for are that deployment's protocol, so the framework takes
 * the finished URL and headers rather than composing either.
 */
export interface RemoteConfigurationSource {
  /** The full URL, e.g. `http://config:3190/api/config/order-service`. */
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Fetches a service's configuration from a configuration service and returns
 * it as a {@link ConfigurationPlain}. Backends call this at boot to resolve
 * their own parameters (e.g. `mongo.uri`) instead of hardcoding them.
 *
 * Uses Node's global `fetch` (same transport approach as the REST client); any
 * network/parse/non-2xx failure becomes an {@link EntifixConnError}. Each
 * attempt is deadlined ({@link defaultConfigAttemptTimeoutMs}) and the fetch is
 * retried on a bounded schedule ({@link defaultConfigRetrySchedule}), so a
 * dependent that boots before config-service is HTTP-ready waits it out — and
 * one that reaches a socket nobody is answering gives up rather than hanging.
 */
export const loadRemoteConfiguration = (
  source: RemoteConfigurationSource,
  options: LoadRemoteConfigurationOptions = {},
): Effect.Effect<ConfigurationPlain, EntifixConnError> => {
  const { url } = source;
  const attemptTimeoutMs =
    options.attemptTimeoutMs ?? defaultConfigAttemptTimeoutMs;

  const fetchOnce = Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: source.headers,
        signal: AbortSignal.timeout(attemptTimeoutMs),
      }).catch((error: unknown) => {
        // Rewritten because the raw abort says `This operation was aborted`,
        // which reads like a bug in the caller rather than a silent peer.
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new Error(
            `the configuration source did not answer within ${attemptTimeoutMs}ms at ${url}`,
          );
        }
        throw error;
      });
      if (!response.ok) {
        throw new Error(
          `the configuration source responded ${response.status} for ${url}`,
        );
      }
      return (await response.json()) as ConfigurationPlain;
    },
    catch: error =>
      new EntifixConnError(`Failed to load configuration from ${url}`, error, {
        url,
      }),
  });

  return Effect.retry(
    fetchOnce,
    options.retrySchedule ?? defaultConfigRetrySchedule,
  );
};

/**
 * Convenience: load the remote configuration and wrap it in a
 * {@link ConfigurationClientInMemory}, to read the service's own parameters via
 * `.in(group).getString(key)` or to hand to an adapter that is built with one.
 */
export const loadRemoteConfigurationClient = (
  source: RemoteConfigurationSource,
  options: LoadRemoteConfigurationOptions = {},
): Effect.Effect<ConfigurationClientInMemory, EntifixConnError> =>
  loadRemoteConfiguration(source, options).pipe(
    Effect.map(plain => new ConfigurationClientInMemory(plain)),
  );
