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
const violations = async (path: string, code: string): Promise<string[]> => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: join(REPO_ROOT, path),
  });
  return (result?.messages ?? [])
    .filter(message => message.ruleId === RULE)
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
