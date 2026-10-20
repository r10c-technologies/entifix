import type { ConfigurationRepositoryTag } from '@entifix/business';
import { Cause, Effect, Exit, type Layer, Option } from 'effect';

import { stubConfigurationLayer } from '../doubles/configuration.js';

/**
 * Runs an Effect that still requires `TContext`, providing it from `layer`.
 *
 * Use-cases are `Effect.gen` blocks yielding Context tags; every spec would
 * otherwise repeat the same `Effect.runPromise(uc.pipe(Effect.provide(…)))`
 * incantation.
 */
export const runUC = <TValue, TError, TContext>(
  effect: Effect.Effect<TValue, TError, TContext>,
  layer: Layer.Layer<TContext>,
): Promise<TValue> => Effect.runPromise(Effect.provide(effect, layer));

/**
 * Runs an Effect expected to fail and returns its typed error.
 *
 * Asserting on the error value beats asserting that a promise rejected: it is
 * the difference between "something went wrong" and "it failed with the
 * `EntifixLockError` that the facade turns into a 409".
 */
export const expectFailure = async <TValue, TError, TContext>(
  effect: Effect.Effect<TValue, TError, TContext>,
  layer: Layer.Layer<TContext>,
): Promise<TError> => {
  const exit = await Effect.runPromiseExit(Effect.provide(effect, layer));

  if (Exit.isSuccess(exit)) {
    throw new Error(
      `Expected the effect to fail, but it succeeded with: ${JSON.stringify(
        exit.value,
      )}`,
    );
  }

  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure)) {
    return failure.value;
  }
  throw new Error(
    `Expected a typed failure, but the effect died with: ${String(exit.cause)}`,
  );
};

/**
 * Runs a repository Effect.
 *
 * Every `EntityRepository` method declares `ConfigurationRepositoryTag` in its
 * requirement channel — the REST-backed adapters resolve their endpoints
 * through it — so even a repository that needs no configuration has to be given
 * one. `configuration` supplies it for the adapters that do.
 */
export const runRepository = <TValue, TError>(
  effect: Effect.Effect<TValue, TError, ConfigurationRepositoryTag>,
  configuration: Layer.Layer<ConfigurationRepositoryTag> = stubConfigurationLayer(),
): Promise<TValue> => Effect.runPromise(Effect.provide(effect, configuration));

/** {@link runRepository}, for an Effect expected to fail. */
export const runRepositoryExit = <TValue, TError>(
  effect: Effect.Effect<TValue, TError, ConfigurationRepositoryTag>,
  configuration: Layer.Layer<ConfigurationRepositoryTag> = stubConfigurationLayer(),
): Promise<Exit.Exit<TValue, TError>> =>
  Effect.runPromiseExit(Effect.provide(effect, configuration));

/** Runs an Effect that requires nothing, returning its value. */
export const run = <TValue, TError>(
  effect: Effect.Effect<TValue, TError>,
): Promise<TValue> => Effect.runPromise(effect);

/** Runs an Effect that requires nothing and returns its typed error. */
export const runFailure = async <TValue, TError>(
  effect: Effect.Effect<TValue, TError>,
): Promise<TError> => {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    throw new Error(
      `Expected the effect to fail, but it succeeded with: ${JSON.stringify(
        exit.value,
      )}`,
    );
  }
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure)) {
    return failure.value;
  }
  throw new Error(
    `Expected a typed failure, but the effect died with: ${String(exit.cause)}`,
  );
};
