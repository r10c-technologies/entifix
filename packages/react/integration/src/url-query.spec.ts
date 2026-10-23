import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Every relative module a file imports, followed until there are no more. */
const reachable = (entry: string): Map<string, string> => {
  const seen = new Map<string, string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const text = readFileSync(file, 'utf8');
    seen.set(file, text);
    for (const [, spec] of text.matchAll(/from '(\.[^']+)'/g)) {
      visit(join(dirname(file), (spec as string).replace(/\.js$/, '.ts')));
    }
  };
  visit(join(SRC, entry));
  return seen;
};

/**
 * The reason the entry exists (#353): a server component parsing
 * `searchParams` must not load React's hooks to do it. A later import added to
 * `url-query.ts` that reached React would pass every other spec.
 */
describe('the url-query entry', () => {
  it('reaches no React and no TanStack', () => {
    const files = reachable('url-query.ts');

    expect(files.size).toBeGreaterThan(1);
    for (const [file, text] of files) {
      expect(text, file).not.toMatch(/from '(react|@tanstack\/[^']+)'/);
    }
  });

  it('is not re-exported through ./url', () => {
    expect(readFileSync(join(SRC, 'url.ts'), 'utf8')).not.toMatch(
      /from '\.\/url\/url-query/,
    );
  });
});
