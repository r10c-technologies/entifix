import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import {
  type A11yBaseline,
  type A11yViolation,
  compareWithBaseline,
  describeVerdict,
  findingsOf,
  updateBaseline,
  WCAG_22_AA_TAGS,
} from './baseline.js';
import { settled } from './settle.js';

export interface A11yGateOptions {
  /** The screen's name in every fingerprint: stable, and one per screen. */
  readonly screen: string;
  /** The committed baseline, shared by every screen of one e2e project. */
  readonly baselinePath: string;
  /** Selectors axe skips, for third-party widgets the host does not render. */
  readonly exclude?: readonly string[];
}

const readBaseline = (path: string): A11yBaseline =>
  existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as A11yBaseline)
    : {};

/**
 * Runs `write` while holding a directory lock beside `path`. Playwright runs
 * screens in parallel workers, and two of them rewriting one baseline at once
 * would each drop the other's screen.
 */
const underLock = (path: string, write: () => void) => {
  const lock = `${path}.lock`;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (attempt > 400) throw error;
      Atomics.wait(wait, 0, 0, 25);
    }
  }
  try {
    write();
  } finally {
    rmdirSync(lock);
  }
};

/**
 * Runs axe over the page against WCAG 2.2 AA and fails on a serious or
 * critical violation the baseline does not accept, or on an accepted one that
 * is gone. Moderate and minor findings are attached to the test as an
 * annotation and never fail it.
 *
 * With `A11Y_BASELINE=update` it rewrites this screen's entries instead: an
 * owner is kept where the fingerprint survived and left empty where it is new,
 * for a person to fill with the issue that removes it.
 */
export async function expectNoNewA11yViolations(
  page: Page,
  { screen, baselinePath, exclude = [] }: A11yGateOptions,
): Promise<void> {
  await settled(page);
  // `ancestry`: fingerprint by the node's full path, which does not depend on
  // what else happens to be on the page (`A11yNodeResult.ancestry`).
  let builder = new AxeBuilder({ page })
    .withTags([...WCAG_22_AA_TAGS])
    .options({ ancestry: true });
  for (const selector of exclude) builder = builder.exclude(selector);
  const results = await builder.analyze();
  const findings = findingsOf(
    screen,
    results.violations as unknown as readonly A11yViolation[],
  );

  if (process.env['A11Y_BASELINE'] === 'update') {
    underLock(baselinePath, () => {
      const next = updateBaseline(screen, findings, readBaseline(baselinePath));
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    });
    return;
  }

  const verdict = compareWithBaseline(
    screen,
    findings,
    readBaseline(baselinePath),
  );
  for (const finding of verdict.reported) {
    test.info().annotations.push({
      type: `a11y ${finding.impact}`,
      description: `${finding.fingerprint} — ${finding.help}`,
    });
  }
  expect(
    [...verdict.added.map(finding => finding.fingerprint), ...verdict.stale],
    describeVerdict(screen, verdict),
  ).toEqual([]);
}
