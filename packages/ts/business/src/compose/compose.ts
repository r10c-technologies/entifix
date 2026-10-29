import { FieldProblem, Invalid } from '@entifix/core';
import { Effect, Schema } from 'effect';

import type { FragmentCatalog } from '../flow/catalog.js';
import type { FragmentKeys } from '../flow/fragment.js';
import {
  type Slip,
  SLIP_VERSION,
  type SlipResolution,
  type SlipSegment,
  type SlipStep,
  slipSteps,
} from '../flow/slip.js';
import {
  assertValidSlip,
  type CompositionRefused,
  type SlipViolation,
  validateSlip,
} from '../flow/validate.js';
import {
  dryRun,
  type ResolutionRule,
  Unresolvable,
} from '../resolve/resolve.js';
import type { VerifiedContext } from '../resolve/verified-context.js';

/** A gate over what is known when the flow starts. Never over anything else. */
export type RecipeGate<I> = (
  context: VerifiedContext,
  input: I,
  segment?: SlipSegment,
) => boolean;

/** One step of a recipe: a fragment by its pinned reference, as a string. */
export interface RecipeStep<I> {
  readonly ref: string;
  /** The step's name in the slip; defaults to the fragment id. */
  readonly step?: string;
  readonly when?: RecipeGate<I>;
  /** Parameters pinned at composition, read from the context's config. */
  readonly parameters?: (
    context: VerifiedContext,
  ) => Readonly<Record<string, unknown>>;
}

/**
 * One stage of a recipe. A `perSegment` stage is expanded once per segment the
 * start input names — one per vendor, say — each step tagged with its segment
 * and named `<segment key>:<step>`.
 */
export interface RecipeStage<I> {
  readonly name: string;
  readonly when?: RecipeGate<I>;
  readonly perSegment?: boolean;
  readonly steps: readonly RecipeStep<I>[];
}

/** A use case the recipe resolves, recorded on the slip as it was resolved. */
export interface RecipeResolution {
  readonly useCase: string;
  readonly rules: readonly ResolutionRule<unknown>[];
}

/**
 * A named template a slip is composed from. It references fragments by
 * `id@n` strings, never by import, so no domain imports another to take part in
 * a flow.
 */
export interface Recipe<I> {
  readonly name: string;
  /** The start input, decoded before anything else is read from it. */
  readonly input: Schema.Codec<I, unknown>;
  /** Keys the start input provides to the first steps, with their schemas. */
  readonly provides?: FragmentKeys;
  /** A checkout needs a commit point even with nothing retriable in it. */
  readonly requiresCommitPoint?: boolean;
  /** The segments a `perSegment` stage expands over. */
  readonly segments?: (input: I) => readonly SlipSegment[];
  readonly resolve?: readonly RecipeResolution[];
  readonly stages: readonly RecipeStage<I>[];
}

/** What a composition is stamped with: both are inputs, so composing is deterministic. */
export interface ComposeOptions {
  readonly flowId: string;
  readonly composedAt: string;
}

const segmentKey = (segment: SlipSegment): string =>
  [segment.vendor, segment.paymentMethod].filter(Boolean).join('/');

const buildStep = <I>(
  recipeStep: RecipeStep<I>,
  catalog: FragmentCatalog,
  context: VerifiedContext,
  segment: SlipSegment | undefined,
): SlipStep => {
  const fragment = catalog.get(recipeStep.ref);
  const name = recipeStep.step ?? fragment?.id ?? recipeStep.ref;
  const parameters = recipeStep.parameters?.(context);
  return {
    ref: recipeStep.ref,
    step: segment === undefined ? name : `${segmentKey(segment)}:${name}`,
    cardinality: fragment?.cardinality ?? 'one',
    ...(segment === undefined ? {} : { segment }),
    ...(fragment?.participant === undefined
      ? {}
      : { participant: fragment.participant }),
    ...(fragment?.call === undefined ? {} : { call: fragment.call }),
    ...(fragment?.compensation === undefined
      ? {}
      : { compensation: fragment.compensation }),
    ...(parameters === undefined ? {} : { parameters }),
  };
};

const resolutionOf = (
  resolutions: readonly RecipeResolution[],
  context: VerifiedContext,
): Effect.Effect<readonly SlipResolution[], Unresolvable> =>
  Effect.forEach(resolutions, ({ useCase, rules }) => {
    const chosen = dryRun(rules, context);
    return chosen === undefined
      ? Effect.fail(new Unresolvable({ useCase }))
      : Effect.succeed({ useCase, variant: chosen.variant, rule: chosen.rule });
  });

/** Expands the recipe into an unvalidated slip. */
const draft = <I>(
  recipe: Recipe<I>,
  catalog: FragmentCatalog,
  context: VerifiedContext,
  input: I,
  resolution: readonly SlipResolution[],
  options: ComposeOptions,
): Slip => {
  const segments = recipe.segments?.(input) ?? [];
  const stages = recipe.stages
    .filter(stage => stage.when?.(context, input) ?? true)
    .map(stage => {
      const each: readonly (SlipSegment | undefined)[] =
        stage.perSegment === true ? segments : [undefined];
      return {
        name: stage.name,
        steps: each.flatMap(segment =>
          stage.steps
            .filter(
              recipeStep => recipeStep.when?.(context, input, segment) ?? true,
            )
            .map(recipeStep =>
              buildStep(recipeStep, catalog, context, segment),
            ),
        ),
      };
    })
    .filter(stage => stage.steps.length > 0);
  return {
    slipVersion: SLIP_VERSION,
    flowId: options.flowId,
    recipe: recipe.name,
    ...(recipe.requiresCommitPoint === undefined
      ? {}
      : { requiresCommitPoint: recipe.requiresCommitPoint }),
    stages,
    resolution,
    composedAt: options.composedAt,
  };
};

const decodeInput = <I>(recipe: Recipe<I>, input: unknown) =>
  Schema.decodeUnknownEffect(recipe.input)(input).pipe(
    Effect.mapError(
      error =>
        new Invalid({
          errors: [
            FieldProblem.make({
              pointer: '',
              detail: error.message,
              code: 'invalidFlowInput',
            }),
          ],
        }),
    ),
  );

/**
 * Composes a recipe into a pinned, validated slip for one caller: decodes the
 * start input, resolves the recipe's use cases, expands per-segment stages,
 * pins versions and parameters, stamps `slipVersion`, validates, and annotates
 * the span with `entifix.slip.version` and `entifix.slip.fragments`.
 *
 * An unknown `id@n` is a `CompositionRefused` carrying `UnknownFragment`, never
 * a throw. The same context, input and options always give the same slip.
 */
export const compose = <I>(
  recipe: Recipe<I>,
  catalog: FragmentCatalog,
  context: VerifiedContext,
  input: unknown,
  options: ComposeOptions,
): Effect.Effect<Slip, CompositionRefused | Unresolvable | Invalid> =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(recipe, input);
    const resolution = yield* resolutionOf(recipe.resolve ?? [], context);
    const slip = yield* assertValidSlip(
      draft(recipe, catalog, context, decoded, resolution, options),
      catalog,
      {
        context,
        ...(recipe.provides === undefined ? {} : { start: recipe.provides }),
      },
    );
    yield* Effect.annotateCurrentSpan({
      'entifix.slip.version': slip.slipVersion,
      'entifix.slip.fragments': slipSteps(slip)
        .map(step => step.ref)
        .join(','),
    });
    return slip;
  });

/** One axis value, labelled so a report can say which combination broke. */
export interface Labelled<T> {
  readonly label: string;
  readonly value: T;
}

/** The axes a recipe is enumerated over. */
export interface CompositionAxes<I> {
  readonly contexts: readonly Labelled<VerifiedContext>[];
  readonly inputs: readonly Labelled<I>[];
}

/** How one combination composed. */
export interface CompositionOutcome {
  readonly context: string;
  readonly input: string;
  /** `composed`, `unresolvable` (the caller is offered no variant), or `refused`. */
  readonly outcome: 'composed' | 'unresolvable' | 'refused';
  readonly violations: readonly SlipViolation[];
}

const ENUMERATED: ComposeOptions = {
  flowId: 'enumerated',
  composedAt: '1970-01-01T00:00:00.000Z',
};

/**
 * Composes the recipe for every context × input and reports each outcome —
 * what a CI job runs to prove that every combination a recipe can produce is a
 * valid slip before it ships. An unresolvable combination is a caller who is
 * offered nothing, which is not a defect; a refused one is.
 */
export const enumerateCompositions = <I>(
  recipe: Recipe<I>,
  catalog: FragmentCatalog,
  axes: CompositionAxes<I>,
): readonly CompositionOutcome[] =>
  axes.contexts.flatMap(context =>
    axes.inputs.map(input => {
      const resolved = Effect.runSync(
        Effect.result(resolutionOf(recipe.resolve ?? [], context.value)),
      );
      if (resolved._tag === 'Failure')
        return {
          context: context.label,
          input: input.label,
          outcome: 'unresolvable' as const,
          violations: [],
        };
      const violations = validateSlip(
        draft(
          recipe,
          catalog,
          context.value,
          input.value,
          resolved.success,
          ENUMERATED,
        ),
        catalog,
        {
          context: context.value,
          ...(recipe.provides === undefined ? {} : { start: recipe.provides }),
        },
      );
      return {
        context: context.label,
        input: input.label,
        outcome:
          violations.length === 0
            ? ('composed' as const)
            : ('refused' as const),
        violations,
      };
    }),
  );

/**
 * Throws, listing every refused combination, unless all of them composed or
 * were unresolvable. Framework-neutral on purpose: any test runner reports a
 * thrown error.
 */
export const expectAllCompositionsValid = (
  outcomes: readonly CompositionOutcome[],
): void => {
  const refused = outcomes.filter(outcome => outcome.outcome === 'refused');
  if (refused.length > 0)
    throw new Error(
      `${String(refused.length)} composition(s) are not valid slips:\n` +
        refused
          .map(
            outcome =>
              `  ${outcome.context} × ${outcome.input}: ` +
              outcome.violations
                .map(violation => `${violation.tag} (${violation.detail})`)
                .join('; '),
          )
          .join('\n'),
    );
};
