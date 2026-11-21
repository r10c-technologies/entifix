#!/usr/bin/env node
/**
 * Narrows every published package's npm trusted-publisher configuration to the
 * `npm-publish` GitHub Environment.
 *
 *   node tools/release/narrow-trust.mjs --check   # read-only: what each package has now
 *   node tools/release/narrow-trust.mjs           # replace every config that is not the target
 *
 * Why a replacement rather than an addition: the registry holds **one**
 * configuration per package, and creating a second fails. So each package goes
 * revoke → create, and between the two it has no trusted publisher at all. The
 * script is idempotent for exactly that reason — a package already carrying the
 * target is skipped, and one left with nothing is created — so if it stops
 * halfway, fix the cause and run it again.
 *
 * Run it from a real terminal, not through a pipe: npm asks for two-factor
 * authentication in the browser. On the first prompt, tick the option to skip
 * two-factor authentication for the next five minutes, or you will be asked for
 * every one of the 46 writes.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  createTrust,
  describe,
  ENVIRONMENT,
  FILE,
  isTarget,
  listTrust,
  npm,
  REPOSITORY,
  requireLogin,
  sleep,
} from './npm-terminal.mjs';

const CHECK_ONLY = process.argv.includes('--check');

const packages = execFileSync('git', ['ls-files', 'packages/**/package.json'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .map(file => JSON.parse(readFileSync(file, 'utf8')))
  .filter(manifest => !manifest.private)
  .map(manifest => manifest.name)
  .sort();

requireLogin();
console.log(
  `${packages.length} packages → ${REPOSITORY} ${FILE} environment=${ENVIRONMENT}\n`,
);

const summary = { alreadyDone: [], replaced: [], wouldReplace: [] };

for (const pkg of packages) {
  const configs = listTrust(pkg);
  console.log(`● ${pkg}`);
  for (const config of configs)
    console.log(`    ${isTarget(config) ? '✓' : '✗'} ${describe(config)}`);
  if (configs.length === 0) console.log('    (no trusted publisher)');

  if (configs.length === 1 && isTarget(configs[0])) {
    summary.alreadyDone.push(pkg);
    continue;
  }
  if (CHECK_ONLY) {
    summary.wouldReplace.push(pkg);
    continue;
  }

  for (const config of configs) {
    npm(['trust', 'revoke', pkg, `--id=${config.id}`]);
    await sleep(2000);
  }
  try {
    createTrust(pkg);
  } catch (error) {
    if (configs.length > 0) {
      console.error(
        `\n⚠️  ${pkg} now has NO trusted publisher: its old config was revoked and the new one failed.`,
      );
      console.error(
        '   Nothing can publish it until this is fixed. Run the script again once the cause is resolved.',
      );
    } else {
      console.error(
        `\n${pkg} had no trusted publisher before this run, and creating one failed. Nothing was revoked.`,
      );
    }
    throw error;
  }
  await sleep(2000);

  const after = listTrust(pkg);
  if (!(after.length === 1 && isTarget(after[0]))) {
    throw new Error(
      `${pkg}: expected exactly the target config after replacing, found ${after.map(describe).join('; ') || 'none'}`,
    );
  }
  console.log('    → replaced and verified');
  summary.replaced.push(pkg);
}

console.log(`\nAlready narrowed: ${summary.alreadyDone.length}`);
if (CHECK_ONLY) console.log(`Would replace:    ${summary.wouldReplace.length}`);
else console.log(`Replaced:         ${summary.replaced.length}`);
