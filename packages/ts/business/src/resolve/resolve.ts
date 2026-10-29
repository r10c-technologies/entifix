import { Failure } from '@entifix/core';
import { Context, Effect, Schema } from 'effect';

import type { FragmentRequirements } from '../flow/fragment.js';
import {
  type VerifiedContext,
  VerifiedContextTag,
} from './verified-context.js';

/** One implementation of a use case, and what a caller must hold to be given it. */
export interface Variant<S> {
  readonly name: string;
  readonly requires?: FragmentRequirements;
  readonly impl: S;
}

/** A predicate over the verified context. Never over request input. */
export type ContextPredicate = (context: VerifiedContext) => boolean;

/** One ordered rule: when the predicate holds, use the variant. */
export interface ResolutionRule<S> {
  readonly when: ContextPredicate;
  readonly variant: Variant<S>;
}

/** Starts a rule: `When(isVendor).use(counterSale)`. */
export const When = (when: ContextPredicate) => ({
  use: <S>(variant: Variant<S>): ResolutionRule<S> => ({ when, variant }),
});

/** The last rule: matches every context that met the variant's requirements. */
export const Otherwise = {
  use: <S>(variant: Variant<S>): ResolutionRule<S> => ({
    when: () => true,
    variant,
  }),
} as const;

/**
 * No rule chose an implementation for this caller — forbidden, because the
 * caller is not entitled to any variant of the use case it asked for.
 */
export class Unresolvable extends Failure.forbidden<Unresolvable>()(
  'Unresolvable',
  'variantUnavailable',
  { useCase: Schema.String },
  { message: ({ useCase }) => `no variant of '${useCase}' is available` },
) {}

const meets = (
  requires: FragmentRequirements | undefined,
  context: VerifiedContext,
): boolean =>
  (requires?.entitlements ?? []).every(entitlement =>
    context.entitlements.includes(entitlement),
  ) &&
  (requires?.roles ?? []).every(role => context.roles.includes(role)) &&
  (requires?.partyRoles === undefined ||
    requires.partyRoles.includes(context.partyRole ?? '')) &&
  (requires?.channels === undefined ||
    requires.channels.includes(context.channel ?? ''));

/** Which variant the rules would choose, and by which rule — without running it. */
export interface DryRun {
  readonly variant: string;
  readonly rule: number;
}

/**
 * Walks the rules in order and answers the first whose variant the caller
 * meets the requirements of **and** whose predicate holds. A variant's
 * requirements are checked first: an unentitled variant is skipped, never
 * chosen and then refused.
 */
export const dryRun = <S>(
  rules: readonly ResolutionRule<S>[],
  context: VerifiedContext,
): DryRun | undefined => {
  const index = rules.findIndex(
    rule => meets(rule.variant.requires, context) && rule.when(context),
  );
  const chosen = rules[index];
  return chosen === undefined
    ? undefined
    : { variant: chosen.variant.name, rule: index };
};

/**
 * Resolves a use case's variant for a verified context, annotating the current
 * span with `entifix.use_case` and `entifix.variant`.
 */
export const resolve =
  <S>(useCase: string, rules: readonly ResolutionRule<S>[]) =>
  (context: VerifiedContext): Effect.Effect<Variant<S>, Unresolvable> => {
    const chosen = dryRun(rules, context);
    const rule = chosen === undefined ? undefined : rules[chosen.rule];
    return rule === undefined
      ? Effect.fail(new Unresolvable({ useCase }))
      : Effect.as(
          Effect.annotateCurrentSpan({
            'entifix.use_case': useCase,
            'entifix.variant': rule.variant.name,
          }),
          rule.variant,
        );
  };

/**
 * A use case's variants and the rules that choose between them — a value,
 * not a `Layer`, so the layer graph is built once at boot and the choice is
 * made per request.
 */
export interface DefinedVariants<I, S> {
  readonly tag: Context.Key<I, S>;
  readonly useCase: string;
  readonly variants: readonly Variant<S>[];
  readonly rules: readonly ResolutionRule<S>[];
}

export const defineVariants = <I, S>(
  tag: Context.Key<I, S>,
  rules: readonly ResolutionRule<S>[],
  useCase: string = tag.key,
): DefinedVariants<I, S> => ({
  tag,
  useCase,
  variants: [...new Set(rules.map(rule => rule.variant))],
  rules,
});

/**
 * Provides the variant the current request resolves to, through
 * `Effect.provideService`: two requests with different contexts run different
 * implementations over one layer graph.
 */
export const provideResolved =
  <I, S>(defined: DefinedVariants<I, S>) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | Unresolvable, Exclude<R, I> | VerifiedContextTag> =>
    Effect.flatMap(VerifiedContextTag, context =>
      Effect.flatMap(
        resolve(defined.useCase, defined.rules)(context),
        variant => Effect.provideService(effect, defined.tag, variant.impl),
      ),
    );
