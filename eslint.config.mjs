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
// `tools/tiers/src/registry.ts` — and on a same-tier edge the register does not
// declare, which this rule also cannot see. Neither check replaces the other.
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

/**
 * Mechanisms never log; the fork site does
 * ([ADR 0013](docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)).
 * A relay, an adapter, a hook or a control says what happened as a value —
 * an outcome, a failure — and the host that started it decides the level
 * and the sink, so one failure is logged once and where someone set the
 * policy. `tools/conventions` lints a planted violation with this very
 * config, so the rule cannot quietly stop matching.
 *
 * BasePath-agnostic: Nx runs ESLint from each project's own directory, so a
 * workspace-rooted glob would match nothing. The places allowed to log opt
 * out in their own configs — the testing packages, `ts/tooling` (the logger
 * itself) and the tools; an example is a host and opts out the day it logs —
 * or are named here: the service shell's policy (`observability.ts`,
 * `respond.ts`), and the saga engine, which the workflow interpreter replaces
 * wholesale.
 *
 * Exported because a preset spread after the base — Nx's `flat/react` sets its
 * own `no-restricted-syntax` — replaces the rule wholesale, and a project that
 * spreads one has to put this back last. The planted-violation spec is what
 * found that.
 */
export const mechanismsDoNotLog = {
  files: ['**/src/**/*.ts', '**/src/**/*.tsx'],
  ignores: [
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.stories.tsx',
    '**/src/engine/**',
    '**/src/observability.ts',
    '**/src/respond.ts',
  ],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "MemberExpression[object.name='Effect'][property.name=/^(log[A-Za-z]*|annotateLogs|withLogSpan)$/]",
        message:
          'A mechanism does not log: return or report an outcome, and let the fork site that started it decide the level (ADR 0013).',
      },
      {
        selector: "MemberExpression[object.name='console']",
        message:
          'A mechanism does not log: return or report an outcome, and let the fork site that started it decide the level (ADR 0013).',
      },
    ],
  },
};

/**
 * Nothing below the shell composes a flow or mints a verified context
 * ([ADR 0015](docs/adr/0015-composed-flows-and-use-case-resolution.md)): an
 * adapter or a double that imported `@entifix/business/compose` could build a
 * slip the interpreter would run, and one that imported `/verified` could
 * forge the context a resolver trusts.
 *
 * A function of the globs because of the basePath note above: a tier-2 or
 * tier-5 package with a config of its own spreads it with `**​/src/**`,
 * and the root applies it to the packages that have none with
 * workspace-rooted globs. The planted-violation spec checks both.
 */
export const compositionStaysAtTheShell = files => ({
  files,
  ignores: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: ['@entifix/business/compose', '@entifix/business/verified'].map(
          name => ({
            name,
            message:
              'Only a shell composes a flow or builds a verified context; an adapter or a double receives a pinned slip and a context it was handed (ADR 0015).',
          }),
        ),
      },
    ],
  },
});

/**
 * Two mechanisms each live in exactly one package, and nothing else imports
 * them:
 *
 * - HTTP is the service shell's
 *   ([ADR 0020](docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)):
 *   a cell declares endpoints as Schema descriptors and the shell builds the
 *   `HttpApi`, so only the shell and `@entifix/rest`'s endpoint client import
 *   `effect/http` or `effect/http-api`.
 * - Durable workflows are `@entifix/workflow`'s
 *   ([ADR 0016](docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)):
 *   a flow is a pinned slip behind `FlowEngineTag`, so only that package
 *   imports `effect/workflow` or `effect/cluster`, whose APIs are unstable.
 *
 * One rule carries both, because two config objects naming one rule replace
 * each other's options rather than adding up — and
 * `@typescript-eslint/no-restricted-imports` rather than the core rule, which
 * `compositionStaysAtTheShell` configures. A place allowed one mechanism opts
 * into it with `importsContained`, which re-declares the rule without it.
 */
export const CONTAINED_IMPORT_RULE = '@typescript-eslint/no-restricted-imports';

const CONTAINED = {
  http: {
    group: [
      'effect/http',
      'effect/http/*',
      'effect/http-api',
      'effect/http-api/*',
    ],
    message:
      'Only the service shell speaks HTTP: declare an endpoint with defineEndpoint and let the shell build the API (ADR 0020).',
  },
  workflow: {
    group: [
      'effect/workflow',
      'effect/workflow/*',
      'effect/cluster',
      'effect/cluster/*',
    ],
    message:
      'Only @entifix/workflow runs durable flows: start a pinned slip through FlowEngineTag (ADR 0016).',
  },
};

/** The containment rule for `files`, with the mechanisms `allowed` there let through. */
export const importsContained = (files, allowed = []) => ({
  files,
  ignores: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
  rules: {
    [CONTAINED_IMPORT_RULE]: [
      'error',
      {
        patterns: Object.entries(CONTAINED)
          .filter(([name]) => !allowed.includes(name))
          .map(([, pattern]) => pattern),
      },
    ],
  },
});

/** Tier-2 and tier-5 packages that lint with the root config alone. */
const ROOT_LINTED_BELOW_THE_SHELL = [
  'packages/ts/redis-client/src/**/*.ts',
  'packages/ts/amqp-client/src/**/*.ts',
  'packages/ts/transactions/src/**/*.ts',
  'packages/ts/jwt-client/src/**/*.ts',
  'packages/ts/zitadel-client/src/**/*.ts',
];

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
    // A project's `test/` directory holds what its suites share — journals, a
    // chaos harness — and is test material like a spec, never shipped.
    files: [
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/test/**/*.ts',
    ],
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
  mechanismsDoNotLog,
  importsContained(['**/src/**/*.ts', '**/src/**/*.tsx']),
  compositionStaysAtTheShell(ROOT_LINTED_BELOW_THE_SHELL),
];
