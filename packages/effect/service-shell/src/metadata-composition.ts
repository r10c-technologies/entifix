import {
  dryRun,
  type ResolutionRule,
  type VerifiedContext,
} from '@entifix/business';
import type { Recipe } from '@entifix/business/compose';
import {
  type FragmentCatalog,
  SLIP_VERSION,
  unmetRequirements,
} from '@entifix/business/flow';
import type { UseCaseComposition, UseCaseDescriptor } from '@entifix/core';

/**
 * What a service can resolve its verbs against, by the names `@useCase()`
 * gives: variant rules, recipes, and the catalog their fragments come from.
 */
export interface MetadataCompositions {
  readonly variants?: Readonly<
    Record<string, readonly ResolutionRule<unknown>[]>
  >;
  // A recipe's start input differs per recipe; the document reads none of it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly recipes?: Readonly<Record<string, Recipe<any>>>;
  readonly catalog?: FragmentCatalog;
}

/**
 * Throws at mount when a descriptor names a variant set or a recipe the
 * service was not given: a verb that cannot be resolved would otherwise be
 * silently missing from every caller's document.
 */
export const assertCompositionsDeclared = (
  descriptors: readonly UseCaseDescriptor[],
  compositions: MetadataCompositions,
): void => {
  const missing = descriptors.flatMap(descriptor => [
    ...(descriptor.variants !== undefined &&
    compositions.variants?.[descriptor.variants] === undefined
      ? [`variants '${descriptor.variants}' (${descriptor.key})`]
      : []),
    ...(descriptor.recipe !== undefined &&
    compositions.recipes?.[descriptor.recipe] === undefined
      ? [`recipe '${descriptor.recipe}' (${descriptor.key})`]
      : []),
  ]);
  if (missing.length > 0)
    throw new Error(
      `$metadata cannot resolve ${missing.join(', ')}: provide them to the route`,
    );
};

/**
 * What a verb resolves to for one caller: its composition, `undefined` for a
 * verb that resolves nothing (no variants, no recipe), or `'unreachable'` when
 * the caller is offered no variant — or the recipe needs a fragment whose
 * requirements the caller does not meet, in a stage no gate can skip. An
 * unreachable verb is omitted from the document.
 */
export const compositionFor = (
  descriptor: UseCaseDescriptor,
  context: VerifiedContext,
  compositions: MetadataCompositions,
): UseCaseComposition | 'unreachable' | undefined => {
  if (descriptor.variants === undefined && descriptor.recipe === undefined)
    return undefined;

  let variant: string | undefined;
  if (descriptor.variants !== undefined) {
    const chosen = dryRun(
      compositions.variants?.[descriptor.variants] ?? [],
      context,
    );
    if (chosen === undefined) return 'unreachable';
    variant = chosen.variant;
  }
  // No recipe means the verb named variants, so one was chosen above.
  if (descriptor.recipe === undefined)
    return { useCase: descriptor.key, variant: variant as string };

  const recipe = compositions.recipes?.[descriptor.recipe];
  for (const resolution of recipe?.resolve ?? []) {
    const chosen = dryRun(resolution.rules, context);
    if (chosen === undefined) return 'unreachable';
    variant ??= chosen.variant;
  }
  const always = (recipe?.stages ?? [])
    .filter(stage => stage.when === undefined)
    .flatMap(stage => stage.steps.filter(step => step.when === undefined));
  const blocked = always.some(step => {
    const requires = compositions.catalog?.get(step.ref)?.requires;
    return (
      requires !== undefined && unmetRequirements(requires, context).length > 0
    );
  });
  if (blocked) return 'unreachable';

  return {
    useCase: descriptor.key,
    variant: variant ?? 'default',
    recipe: descriptor.recipe,
    slipVersion: SLIP_VERSION,
    fragments: [
      ...new Set(
        (recipe?.stages ?? []).flatMap(stage =>
          stage.steps.map(step => step.ref),
        ),
      ),
    ],
  };
};
