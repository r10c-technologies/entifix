import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** The rule ADR 0013 rests on: mechanisms report, the fork site logs. */
const RULE = 'no-restricted-syntax';

/**
 * What the real configuration says about `code` at `path` — a file that does
 * not exist, linted as if it did, through the config Nx lints that project
 * with.
 */
const violations = async (
  path: string,
  code: string,
  rule: string = RULE,
): Promise<string[]> => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: join(REPO_ROOT, path),
  });
  return (result?.messages ?? [])
    .filter(message => message.ruleId === rule)
    .map(message => message.message);
};

/** The severity of each `rule` message `code` at `path` raises (2 = error). */
const severities = async (
  path: string,
  code: string,
  rule: string,
): Promise<number[]> => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: join(REPO_ROOT, path),
  });
  return (result?.messages ?? [])
    .filter(message => message.ruleId === rule)
    .map(message => message.severity);
};

const LOGS = [
  "import { Effect } from 'effect';\nexport const x = Effect.logError('boom');\n",
  "import { Effect } from 'effect';\nexport const x = Effect.void.pipe(Effect.annotateLogs({ a: 1 }));\n",
  "import { Effect } from 'effect';\nexport const x = Effect.void.pipe(Effect.withLogSpan('span'));\n",
  "export const x = () => console.warn('boom');\n",
];

describe('a mechanism does not log', () => {
  it.each([
    ['an adapter', 'packages/ts/mongo-client/src/planted.ts'],
    ['the business layer', 'packages/ts/business/src/planted.ts'],
    ['a control', 'packages/react/controls/src/planted.tsx'],
    ['a React hook', 'packages/react/integration/src/planted.ts'],
    ['the Next shell', 'packages/next/shell/src/planted.ts'],
    [
      'the service shell, outside its policy',
      'packages/effect/service-shell/src/planted.ts',
    ],
    [
      'a package with no config of its own',
      'packages/ts/transactions/src/planted.ts',
    ],
  ])('is refused in %s', async (_label, path) => {
    for (const code of LOGS) {
      expect(await violations(path, code), code).not.toEqual([]);
    }
  });

  it.each([
    [
      'the service shell’s policy',
      'packages/effect/service-shell/src/respond.ts',
    ],
    ['the logger itself', 'packages/ts/tooling/src/planted.ts'],
    ['test tooling', 'packages/ts/testing-unit/src/planted.ts'],
    ['a spec', 'packages/ts/mongo-client/src/planted.spec.ts'],
    [
      'the saga engine the interpreter replaces',
      'packages/ts/transactions/src/engine/planted.ts',
    ],
  ])('is allowed in %s', async (_label, path) => {
    for (const code of LOGS) {
      expect(await violations(path, code), code).toEqual([]);
    }
  });
});

const CLASS_CHECKS = [
  'export const x = (e: unknown) => e instanceof Error;\n',
  'class Refused extends Error {}\nexport const x = (e: unknown) => e instanceof Refused;\n',
  'class NotFoundFailure extends Error {}\nexport const x = (e: unknown) => e instanceof NotFoundFailure;\n',
];

describe('a failure is told apart by its tag, never by its class', () => {
  it.each([
    ['the core', 'packages/ts/core/src/planted.ts'],
    ['a control', 'packages/react/controls/src/planted.tsx'],
    ['the Next shell', 'packages/next/shell/src/planted.ts'],
    ['the service shell', 'packages/effect/service-shell/src/planted.ts'],
  ])('refuses instanceof on a failure class in %s', async (_label, path) => {
    for (const code of CLASS_CHECKS) {
      expect(await violations(path, code), code).not.toEqual([]);
    }
  });

  it('leaves instanceof on anything else alone', async () => {
    expect(
      await violations(
        'packages/ts/core/src/planted.ts',
        'export const x = (d: unknown) => d instanceof Date;\n',
      ),
    ).toEqual([]);
  });
});

const COMPOSES = [
  "import { compose } from '@entifix/business/compose';\nexport const x = compose;\n",
  "import { verifiedContext } from '@entifix/business/verified';\nexport const x = verifiedContext;\n",
];

describe('nothing below the shell composes a flow', () => {
  it.each([
    [
      'an adapter with a config of its own',
      'packages/ts/mongo-client/src/planted.ts',
    ],
    [
      'an adapter linted by the root config',
      'packages/ts/amqp-client/src/planted.ts',
    ],
    ['the transactions package', 'packages/ts/transactions/src/planted.ts'],
    ['a test double', 'packages/ts/testing-unit/src/planted.ts'],
    ['the e2e helpers', 'packages/ts/testing-e2e/src/planted.ts'],
  ])('is refused in %s', async (_label, path) => {
    for (const code of COMPOSES) {
      expect(
        await violations(path, code, 'no-restricted-imports'),
        code,
      ).not.toEqual([]);
    }
  });

  it.each([
    ['the service shell', 'packages/effect/service-shell/src/planted.ts'],
    ['a spec below the shell', 'packages/ts/testing-unit/src/planted.spec.ts'],
  ])('is allowed in %s', async (_label, path) => {
    for (const code of COMPOSES) {
      expect(
        await violations(path, code, 'no-restricted-imports'),
        code,
      ).toEqual([]);
    }
  });
});

const SPEAKS_HTTP = [
  "import { HttpRouter } from 'effect/http';\nexport const x = HttpRouter;\n",
  "import { HttpApi } from 'effect/http-api';\nexport const x = HttpApi;\n",
  "import * as Api from 'effect/http-api/HttpApiBuilder';\nexport const x = Api;\n",
];

describe('only the service shell speaks HTTP', () => {
  it.each([
    ['the business layer', 'packages/ts/business/src/planted.ts'],
    ['core', 'packages/ts/core/src/planted.ts'],
    ['an adapter', 'packages/ts/mongo-client/src/planted.ts'],
    [
      'an adapter linted by the root config',
      'packages/ts/transactions/src/planted.ts',
    ],
    [
      'the REST client, outside its endpoint client',
      'packages/ts/rest-client/src/planted.ts',
    ],
    ['the Next shell', 'packages/next/shell/src/planted.ts'],
  ])('is refused in %s', async (_label, path) => {
    for (const code of SPEAKS_HTTP) {
      expect(
        await violations(
          path,
          code,
          '@typescript-eslint/no-restricted-imports',
        ),
        code,
      ).not.toEqual([]);
    }
  });

  it.each([
    ['the service shell', 'packages/effect/service-shell/src/planted.ts'],
    ['the endpoint client', 'packages/ts/rest-client/src/endpoint/planted.ts'],
    ['a spec', 'packages/ts/core/src/planted.spec.ts'],
  ])('is allowed in %s', async (_label, path) => {
    for (const code of SPEAKS_HTTP) {
      expect(
        await violations(
          path,
          code,
          '@typescript-eslint/no-restricted-imports',
        ),
        code,
      ).toEqual([]);
    }
  });
});

const RUNS_WORKFLOWS = [
  "import { Workflow } from 'effect/workflow';\nexport const x = Workflow;\n",
  "import { ClusterWorkflowEngine } from 'effect/cluster';\nexport const x = ClusterWorkflowEngine;\n",
  "import * as W from 'effect/workflow/Activity';\nexport const x = W;\n",
];

describe('only @entifix/workflow runs durable flows', () => {
  it.each([
    ['the transactions package', 'packages/ts/transactions/src/planted.ts'],
    ['the business layer', 'packages/ts/business/src/planted.ts'],
    ['an adapter', 'packages/ts/sql-client/src/planted.ts'],
    ['the service shell', 'packages/effect/service-shell/src/planted.ts'],
  ])('is refused in %s', async (_label, path) => {
    for (const code of RUNS_WORKFLOWS) {
      expect(
        await violations(
          path,
          code,
          '@typescript-eslint/no-restricted-imports',
        ),
        code,
      ).not.toEqual([]);
    }
  });

  it.each([
    ['the workflow package', 'packages/ts/workflow/src/planted.ts'],
    ['a spec', 'packages/ts/transactions/src/planted.spec.ts'],
  ])('is allowed in %s', async (_label, path) => {
    for (const code of RUNS_WORKFLOWS) {
      expect(
        await violations(
          path,
          code,
          '@typescript-eslint/no-restricted-imports',
        ),
        code,
      ).toEqual([]);
    }
  });

  it('keeps HTTP contained in the workflow package, and workflows in the shell', async () => {
    const http =
      "import { HttpRouter } from 'effect/http';\nexport const x = HttpRouter;\n";

    expect(
      await violations(
        'packages/ts/workflow/src/planted.ts',
        http,
        '@typescript-eslint/no-restricted-imports',
      ),
    ).not.toEqual([]);
  });
});

/**
 * The accessibility rules a linter can check fail the build in every package
 * and example that renders, through each one's own config (ADR 0024). A
 * project that spreads a React preset after `accessibleJsx` would put the
 * preset's `warn` levels back, which is what this plants against.
 */
describe('a click target is reachable by keyboard', () => {
  const CLICKABLE_DIV =
    'export const X = () => <div onClick={() => undefined}>x</div>;\n';

  it.each([
    ['a control', 'packages/react/controls/src/planted.tsx'],
    ['a React hook package', 'packages/react/integration/src/planted.tsx'],
    ['the Next shell', 'packages/next/shell/src/planted.tsx'],
    ['the workspace example', 'examples/workspace/src/planted.tsx'],
    ['the minimal example', 'examples/minimal/src/planted.tsx'],
  ])('is required in %s', async (_label, path) => {
    for (const rule of [
      'jsx-a11y/click-events-have-key-events',
      'jsx-a11y/no-static-element-interactions',
    ]) {
      const [severity] = await severities(path, CLICKABLE_DIV, rule);
      expect(severity, rule).toBe(2);
    }
  });
});

/**
 * The component layers the accessibility gate renders. A component with no
 * story is a component the gate cannot see, so the gate's verdict would be a
 * pass about code it never rendered (ADR 0024).
 */
const STORIED_LAYERS = ['atoms', 'molecules', 'organisms'];

const CONTROLS_UI = join(REPO_ROOT, 'packages/react/controls/src/ui');

/** Every `<layer>/<component>/` folder under `ui` with no `*.stories.tsx`. */
const componentsWithoutStory = (ui: string): string[] =>
  STORIED_LAYERS.flatMap(layer =>
    readdirSync(join(ui, layer), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(
        entry =>
          !readdirSync(join(ui, layer, entry.name)).some(file =>
            file.endsWith('.stories.tsx'),
          ),
      )
      .map(entry => `${layer}/${entry.name}`),
  );

describe('every component has a story', () => {
  it('holds for react-controls', () => {
    expect(componentsWithoutStory(CONTROLS_UI)).toEqual([]);
  });

  it('names a component folder that has none', () => {
    const ui = mkdtempSync(join(tmpdir(), 'controls-ui-'));
    for (const layer of STORIED_LAYERS) mkdirSync(join(ui, layer));
    mkdirSync(join(ui, 'atoms', 'storied'));
    writeFileSync(join(ui, 'atoms', 'storied', 'storied.stories.tsx'), '');
    mkdirSync(join(ui, 'molecules', 'planted'));
    writeFileSync(join(ui, 'molecules', 'planted', 'planted.tsx'), '');

    expect(componentsWithoutStory(ui)).toEqual(['molecules/planted']);
  });
});

/** The spacing scale's names, which Tailwind also accepts after a size utility. */
const SPACING_NAMES = ['3xs', '2xs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl'];

/** A size utility whose suffix is a spacing name, with any variant prefix. */
const SPACING_SIZE = new RegExp(
  String.raw`(?<![\w-])((?:[\w-]+:)*(?:max-w|min-w|w|h|max-h|min-h|size)-(?:${SPACING_NAMES.join('|')}))(?![\w/-])`,
  'g',
);

/**
 * An arbitrary length, colour, duration or z-index written as a literal:
 * `-[12px]`, `-[2rem]`, `-[58%]`, `-[120ms]`, `-[#fff]`, `-[rgb(…)]`, `z-[…]`.
 * `var(--…)` and `calc()`/`color-mix()` over tokens are what is meant instead;
 * an arbitrary *variant* (`aria-[current]:`) ends in a colon and is not a value.
 */
const LITERAL_VALUE = new RegExp(
  String.raw`(?<![\w-])((?:[\w-]+:)*-?[a-z][\w-]*-\[(?:-?\d*\.?\d+(?:px|rem|em|vh|vw|dvh|svh|lvh|ch|%|m?s)|#[0-9a-fA-F]{3,8}|rgba?\([^\]]*\)|hsla?\([^\]]*\))\])(?!:)|(?<![\w-])((?:[\w-]+:)*z-\[[^\]]+\])(?!:)`,
  'g',
);

/**
 * The tokens ADR 0025 rules out of a control's classes, one finding per
 * occurrence. `allowed` names the spacing-sized classes a file means.
 */
const tokenFindings = (
  source: string,
  allowed: readonly string[] = [],
): string[] => [
  ...[...source.matchAll(SPACING_SIZE)]
    .map(match => match[1])
    .filter(found => !allowed.includes(found))
    .map(found => `spacing-sized ${found}`),
  ...[...source.matchAll(LITERAL_VALUE)].map(
    match => `literal ${match[1] ?? match[2]}`,
  ),
];

/**
 * A spacing value a file means as a size, by file, with the reason. Anything
 * else spacing-sized is a container width or a fixed size written with the
 * wrong name, as the command palette's `max-w-xl` was.
 */
const SPACING_SIZE_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // The connector between two steps is a gap drawn as a line: one spacing step
  // long, in whatever scale the wizard sits in.
  'packages/react/controls/src/ui/organisms/wizard/wizard.tsx': ['w-s'],
};

const sourcesUnder = (dir: string): string[] =>
  readdirSync(join(REPO_ROOT, dir), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name))
    // Stories too: the gate renders them, and a story sized with a colliding
    // name shows a control at a width no host gives it.
    .filter(path => !/\.spec\.tsx?$/.test(path))
    .filter(path => !/\/(spec-support|story-support)\//.test(path));

describe('a control sizes with tokens, never with a colliding name or a literal', () => {
  it.each(['packages/react/controls/src', 'packages/next/shell/src'])(
    'holds for %s',
    dir => {
      const findings = sourcesUnder(dir).flatMap(path => {
        const relative = path.slice(REPO_ROOT.length + 1);
        return tokenFindings(
          readFileSync(path, 'utf8'),
          SPACING_SIZE_ALLOWED[relative],
        ).map(finding => `${relative}: ${finding}`);
      });
      expect(findings).toEqual([]);
    },
  );

  it('finds a planted container width written as a spacing name', () => {
    expect(
      tokenFindings('<div className="relative w-full max-w-xl lg:h-s" />'),
    ).toEqual(['spacing-sized max-w-xl', 'spacing-sized lg:h-s']);
  });

  it('finds planted literals of every kind', () => {
    expect(
      tokenFindings(
        "cn('h-[2rem] w-[58%] lg:max-h-[60vh] duration-[120ms] bg-[#000] text-[rgb(0,0,0)] z-[60] -mt-[1px]')",
      ),
    ).toEqual([
      'literal h-[2rem]',
      'literal w-[58%]',
      'literal lg:max-h-[60vh]',
      'literal duration-[120ms]',
      'literal bg-[#000]',
      'literal text-[rgb(0,0,0)]',
      'literal z-[60]',
      'literal -mt-[1px]',
    ]);
  });

  it('leaves tokens, numbers, variants, templates and allowed sizes alone', () => {
    expect(
      tokenFindings(
        [
          'max-w-(--container-xl) p-xl gap-s w-s h-8 size-3.5 max-w-md w-2/5',
          'z-(--z-overlay) duration-(--duration-fast) bg-scrim scale-[0.97]',
          'aria-[current]:font-semibold grid-cols-[repeat(auto-fill,minmax(1rem,1fr))]',
          'bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] max-w-[var(--measure)]',
          'forced-colors:bg-[CanvasText] w-sm h-screen',
        ].join(' '),
        ['w-s'],
      ),
    ).toEqual([]);
  });
});
