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
