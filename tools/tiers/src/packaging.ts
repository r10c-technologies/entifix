/**
 * What an adopter actually receives.
 *
 * `tiers.spec.ts` checks what a package is allowed to drag in with it; this
 * checks that the package arrives at all. Both failures it exists for are
 * silent ones — a tarball missing the files its own `exports` point at, and a
 * scoped package published without `publishConfig.access`, which the registry
 * answers `402 Payment Required` for — and both are discovered by the first
 * consumer rather than by the build.
 *
 * See [ADR 0001](../../../docs/adr/0001-the-tier-contract-and-the-host-seam.md).
 */

/** The condition that resolves to `src` inside this workspace. */
export const SOURCE_CONDITION = '@entifix/source';

/**
 * Targets npm ships whatever `files` says, so `files` has no reason to name
 * them and their absence from it is not a defect.
 */
export const ALWAYS_SHIPPED = new Set(['./package.json']);

const normalize = (path: string): string =>
  path.replace(/^\.\//, '').replace(/^\/+/, '');

const NEGATED_EXTENSION = /^!\*\*\/\*(\.[A-Za-z0-9.]+)$/;

const assertPlain = (pattern: string): void => {
  if (/[*?[\]{}!]/.test(pattern))
    throw new Error(
      `'${pattern}' is not a shape this matcher understands. It reads a ` +
        "'files' entry as a path, a directory prefix, or a '!**/*.ext' " +
        'negation — teach it the new shape rather than leaving a pattern ' +
        'that silently matches nothing.',
    );
};

/**
 * Whether an npm `files` allowlist ships `target`.
 *
 * ⚠️ It deliberately does **not** model npm's force-include of `main`, README
 * and LICENSE, which is the whole reason this check exists. A package whose
 * `files` had lost `dist` still shipped `dist/index.js`, because npm always
 * adds the file `main` names: importing it resolved, every type was `any`,
 * and its second subpath was simply absent. A tarball that is broken looks
 * healthier than one that is empty.
 */
export const shipsFile = (
  files: readonly string[],
  target: string,
): boolean => {
  const wanted = normalize(target);
  let included = false;

  for (const pattern of files) {
    const negated = NEGATED_EXTENSION.exec(pattern);
    if (negated) {
      if (wanted.endsWith(negated[1] as string)) return false;
      continue;
    }

    assertPlain(pattern);
    const entry = normalize(pattern).replace(/\/+$/, '');
    if (wanted === entry || wanted.startsWith(`${entry}/`)) included = true;
  }

  return included;
};

/**
 * Every file an `exports` map points a consumer at.
 *
 * The source condition is skipped: it resolves inside this workspace only,
 * and points at `src`, which a built package deliberately does not ship.
 */
export const exportTargets = (exports: unknown): string[] => {
  if (typeof exports === 'string') return [exports];
  if (exports === null || typeof exports !== 'object') return [];

  return Object.entries(exports as Record<string, unknown>).flatMap(
    ([condition, value]) =>
      condition === SOURCE_CONDITION ? [] : exportTargets(value),
  );
};
