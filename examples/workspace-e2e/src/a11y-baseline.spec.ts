import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { unownedEntries } from '@entifix/testing-e2e/a11y';

import { expect, test } from './support';

/**
 * A baseline entry is accepted debt only while it names the issue that removes
 * it; `A11Y_BASELINE=update` writes a new one with an empty owner, and this
 * refuses it until a person fills it in.
 */
test('every baseline entry names the issue that removes it', () => {
  const baseline = JSON.parse(
    readFileSync(join(__dirname, 'a11y-baseline.json'), 'utf8'),
  ) as Record<string, string>;
  expect(unownedEntries(baseline)).toEqual([]);
});
