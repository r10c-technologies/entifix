import { Cause, Effect, Exit, type Layer, Option } from 'effect';

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
 * Runs an Effect that requires nothing, returning its value.
 *
 * Every repository method is one of these: an adapter binds what it needs when
 * it is built, so a spec runs a repository call with no layer at all.
 */
export const run = <TValue, TError>(
  effect: Effect.Effect<TValue, TError>,
): Promise<TValue> => Effect.runPromise(effect);

/** {@link run}, keeping the exit so a spec can assert on a failure. */
export const runExit = <TValue, TError>(
  effect: Effect.Effect<TValue, TError>,
): Promise<Exit.Exit<TValue, TError>> => Effect.runPromiseExit(effect);

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
