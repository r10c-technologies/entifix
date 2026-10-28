import type { Effect } from 'effect';

import type {
  EntifixFailure,
  FailureCategory,
  FailureFamily,
} from './failure.js';

/**
 * A guard over anything, naming the shape it admits.
 *
 * It is written over `unknown` rather than over a failure union on purpose:
 * TypeScript narrows a union by a guard on a supertype by **filtering** its
 * members, so `if (isCategory('conflict')(e))` leaves exactly the members of
 * `E` whose `category` is `'conflict'` — the same as `Extract<E, Shape>` — and
 * one predicate serves every union it is applied to.
 *
 * The check reads `_tag`, `category` and `family` and never the prototype, so a
 * failure decoded off a wire or defined in a second copy of this module
 * matches exactly as one constructed in place.
 */
export type FailureGuard<Shape> = (value: unknown) => value is Shape;

const readsAs = (value: unknown, key: string, expected: string): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<string, unknown>)[key] === expected;

/** Admits the failure whose `_tag` is `tag`. */
export const isTag =
  <const Tag extends string>(tag: Tag): FailureGuard<{ readonly _tag: Tag }> =>
  (value): value is { readonly _tag: Tag } =>
    readsAs(value, '_tag', tag);

/** Admits every failure in `category`. */
export const isCategory =
  <const C extends FailureCategory>(
    category: C,
  ): FailureGuard<{ readonly category: C }> =>
  (value): value is { readonly category: C } =>
    readsAs(value, 'category', category);

/** Admits every failure in `family`. */
export const isFamily =
  <const F extends FailureFamily>(
    family: F,
  ): FailureGuard<{ readonly family: F }> =>
  (value): value is { readonly family: F } =>
    readsAs(value, 'family', family);

/** Admits any `EntifixFailure`, of any category. */
export const isFailure: FailureGuard<EntifixFailure> = (
  value,
): value is EntifixFailure =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>)['_tag'] === 'string' &&
  typeof (value as Record<string, unknown>)['code'] === 'string' &&
  typeof (value as Record<string, unknown>)['category'] === 'string';

/** Both guards admit it. */
export const and =
  <A, B>(left: FailureGuard<A>, right: FailureGuard<B>): FailureGuard<A & B> =>
  (value): value is A & B =>
    left(value) && right(value);

/** Either guard admits it. */
export const or =
  <A, B>(left: FailureGuard<A>, right: FailureGuard<B>): FailureGuard<A | B> =>
  (value): value is A | B =>
    left(value) || right(value);

/**
 * The guard does not admit it.
 *
 * ⚠️ Generic over the union it is applied to, because "not this shape" has no
 * shape of its own: `not(isFamily('business'))(e)` narrows `E` to
 * `Exclude<E, { family: 'business' }>`. Applied with no union in view — as an
 * argument to {@link and} or {@link or} — it admits correctly and narrows
 * nothing, so keep it the outermost combinator.
 */
export const not =
  <S>(guard: FailureGuard<S>) =>
  <E>(value: E): value is Exclude<E, S> =>
    !guard(value);

/**
 * A guard plus a condition that needs the request — a dial read from
 * configuration, the caller's organization. The guard narrows; the condition
 * decides, and it is an Effect because the context it reads is.
 */
export interface EffectfulFailurePredicate<Shape, R = never> {
  readonly guard: FailureGuard<Shape>;
  readonly condition: (failure: Shape) => Effect.Effect<boolean, never, R>;
}

/** Pairs a guard with a condition read from the request's context. */
export const when = <Shape, R = never>(
  guard: FailureGuard<Shape>,
  condition: (failure: Shape) => Effect.Effect<boolean, never, R>,
): EffectfulFailurePredicate<Shape, R> => ({ guard, condition });
