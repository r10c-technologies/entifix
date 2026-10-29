import type { DefinedVariants, Variant } from '@entifix/business';
import { describe } from 'vitest';

/**
 * The variants a contract suite has run against in this process, per use
 * case. Shared through `globalThis` so two copies of this module — a spec
 * importing the source and a helper importing the build — agree.
 */
const COVERED_KEY = Symbol.for('@entifix/testing-unit/variants-covered');

const covered = (): Map<string, Set<string>> => {
  const holder = globalThis as { [COVERED_KEY]?: Map<string, Set<string>> };
  holder[COVERED_KEY] ??= new Map();
  return holder[COVERED_KEY];
};

/**
 * Runs one use case's contract suite once per variant
 * ([ADR 0015](../../../../../docs/adr/0015-composed-flows-and-use-case-resolution.md)):
 * a variant is an implementation of the use case, so it is held to the same
 * contract as every other. The `describe` names the variant, so a failure says
 * which implementation broke it.
 */
export const forEachVariant = <I, S>(
  defined: DefinedVariants<I, S>,
  suite: (impl: S, variant: Variant<S>) => void,
): void => {
  for (const variant of defined.variants) {
    const names = covered().get(defined.useCase) ?? new Set<string>();
    names.add(variant.name);
    covered().set(defined.useCase, names);
    describe(`${defined.useCase} — variant '${variant.name}'`, () => {
      suite(variant.impl, variant);
    });
  }
};

/**
 * Every variant of the given use cases that no {@link forEachVariant} call has
 * run a contract against — what a conventions check asserts is empty.
 */
export const variantsWithoutContract = (
  definitions: readonly DefinedVariants<unknown, unknown>[],
): readonly string[] =>
  definitions.flatMap(defined =>
    defined.variants
      .filter(
        variant =>
          !(covered().get(defined.useCase)?.has(variant.name) ?? false),
      )
      .map(variant => `${defined.useCase}:${variant.name}`),
  );
