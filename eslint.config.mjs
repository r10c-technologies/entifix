import nx from '@nx/eslint-plugin';
import react from 'eslint-plugin-react';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

// ---------------------------------------------------------------------------
// The tier contract, enforced (ADR 0001).
//
// Every package is tagged in its package.json `nx.tags` with exactly one
// `tier:N`, and may depend only on its own tier or below:
//
//   0 standalone ‹ 1 entity ‹ 2 adapters ‹ 3 ui ‹ 4 app framework ‹ 5 testing
//
// ⚠️ This rule checks DIRECTION only, and direction is the lesser half. What
// actually makes the framework composable — that a package must not hard-depend
// on a capability its tier is meant to be adoptable without — is not expressible
// as a tag constraint, because the edge it forbids points downward and is legal
// here. `pnpm nx test @entifix/tiers` is what fails the build on those, reading
// `tools/tiers/src/registry.ts`. Neither check replaces the other.
// ---------------------------------------------------------------------------

const TIERS = [0, 1, 2, 3, 4, 5];

const tierConstraints = TIERS.map(tier => ({
  sourceTag: `tier:${tier}`,
  onlyDependOnLibsWithTags: TIERS.filter(t => t <= tier).map(t => `tier:${t}`),
}));

// Strict constraints for source files. The trailing `*` catch-all lets any
// untagged project (an example, a tool) and external dependencies still resolve.
const sourceConstraints = [
  ...tierConstraints,
  { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] },
];

// Spec files may additionally pull in `type:testing` doubles and fixtures from
// anywhere — they are test-only and never shipped. Source files stay strict.
const specConstraints = sourceConstraints.map(c =>
  c.sourceTag === '*'
    ? c
    : {
        ...c,
        onlyDependOnLibsWithTags: [
          ...new Set([...c.onlyDependOnLibsWithTags, 'type:testing']),
        ],
      },
);

const allowEslintConfig = ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      // `tsc --build` output. Not ignored here, a `typecheck` run leaves
      // generated `.d.ts` behind that the next `lint` reports errors in — so
      // whether lint passes depends on which targets ran before it.
      '**/out-tsc',
      '**/test-output',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: allowEslintConfig,
          depConstraints: sourceConstraints,
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: allowEslintConfig,
          depConstraints: specConstraints,
        },
      ],
    },
  },
  {
    settings: {
      react: { version: '19.0.0' },
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  /**
   * i18n is mandatory, and this is what makes it so rather than a convention:
   * a user-facing string written straight into JSX fails the build. It applies
   * to the framework's own copy — the controls and the Next shell render for a
   * person, and every string they render belongs in a catalog the package owns.
   *
   * `ignoreProps` stays **true**. Turning it off was the original intent, to
   * catch untranslated `aria-label`s, but the rule cannot tell copy from a
   * machine value: it flags `field="id"`, `value=""` and `type="date"` just as
   * loudly as `aria-label="Theme"`, and the allowlist needed to quiet those
   * would swallow the real findings.
   *
   * `allowedStrings` holds glyphs and separators that carry no language.
   * Anything with a letter in it belongs in a catalog.
   */
  {
    // Deliberately basePath-agnostic: Nx runs `eslint` from each project's own
    // directory, so a workspace-rooted glob matches nothing and the rule
    // silently never fires.
    files: ['**/src/**/*.tsx'],
    // Declared right here rather than leaned on from a project's own config:
    // ESLint resolves a rule's plugin within the same config object, so without
    // this the rule hard-errors in every project that has no React config of
    // its own.
    plugins: { react },
    ignores: [
      '**/*.spec.tsx',
      '**/*.test.tsx',
      '**/*.stories.tsx',
      // Design-system playgrounds: the English *is* the specimen. Translating
      // "HeadingOne" or "Body text with inline strong emphasis" would destroy
      // what the page exists to show.
      '**/design-system/**/*.tsx',
    ],
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: [
            '—',
            '·',
            '/',
            '+',
            '#',
            ':',
            ',',
            '(',
            ')',
            '×',
            '✕',
            '↑',
            '↓',
            '☰',
            '⧉',
            '↗',
            '▸',
            '▾',
            '◍',
            '▦',
            '◈',
            '⊞',
            '◕',
            '◉',
          ],
        },
      ],
    },
  },
];
