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
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPOSITORY = 'r10c-technologies/entifix';
const FILE = 'release.yml';
const ENVIRONMENT = 'npm-publish';
const CHECK_ONLY = process.argv.includes('--check');

const transcripts = mkdtempSync(join(tmpdir(), 'narrow-trust-'));
process.on('exit', () => rmSync(transcripts, { recursive: true, force: true }));

/**
 * Runs npm attached to the terminal. Output that has to be read back goes
 * through `script`, which records a pseudo-terminal session to a file, rather
 * than through a pipe: npm offers browser two-factor authentication only when
 * stdin **and** stdout are TTYs (`otplease` in npm's `lib/utils/auth.js`), and
 * with stdout piped it fails `EOTP` instead of asking — even for a read.
 */
const npm = (args, { capture = false } = {}) => {
  const transcript = join(transcripts, 'session.txt');
  // `--no-progress`: in a terminal npm draws a spinner onto the same line as
  // its output, which is what broke the first version of this parser.
  const npmArgs = [...args, '--no-progress'];
  const [command, argv] = capture
    ? ['script', ['-q', transcript, 'npm', ...npmArgs]]
    : ['npm', npmArgs];
  const result = spawnSync(command, argv, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} exited with ${result.status}`);
  }
  return capture ? readFileSync(transcript, 'utf8') : '';
};

/**
 * Pulls the JSON objects out of a terminal transcript.
 *
 * `npm trust list --json` prints one pretty-printed object per configuration,
 * not an array, and in a pseudo-terminal session they share the transcript with
 * authentication prompts, carriage returns, cursor escapes and — if anything
 * still draws one — spinner glyphs. So nothing is assumed about where a line
 * starts: terminal noise is stripped, and every balanced `{…}` whose first
 * member is a string key is parsed.
 */
const jsonObjectsIn = text => {
  const clean = text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/[⠀-⣿]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  const objects = [];
  for (let start = clean.indexOf('{'); start !== -1;) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = start; i < clean.length; i++) {
      const ch = clean[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) break;
    const chunk = clean.slice(start, end + 1);
    if (/^\{\s*"/.test(chunk)) {
      try {
        objects.push(JSON.parse(chunk));
      } catch {
        // Not JSON after all — keep scanning past it.
      }
    }
    start = clean.indexOf('{', end + 1);
  }
  return objects;
};

const listTrust = pkg => {
  const transcript = npm(['trust', 'list', pkg, '--json'], { capture: true });
  const configs = jsonObjectsIn(transcript).filter(
    object => typeof object.id === 'string',
  );
  // A listing that mentions an id but parsed to nothing is a parser failure,
  // not an empty package. Acting on it would skip the revoke and hit a 409.
  if (configs.length === 0 && transcript.includes('"id"')) {
    throw new Error(
      `${pkg}: npm listed a trust configuration this script could not parse. Nothing was changed.`,
    );
  }
  return configs;
};

const isTarget = config =>
  config.type === 'github' &&
  config.repository === REPOSITORY &&
  config.file === FILE &&
  config.environment === ENVIRONMENT &&
  // Absent when the registry omits it from the listing; present, it must allow publishing.
  (config.permissions === undefined ||
    config.permissions.includes('createPackage'));

const describe = config =>
  `${config.type} ${config.repository ?? '?'} ${config.file ?? '?'} env=${config.environment ?? '(none)'} id=${config.id}`;

const packages = execFileSync('git', ['ls-files', 'packages/**/package.json'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .map(file => JSON.parse(readFileSync(file, 'utf8')))
  .filter(manifest => !manifest.private)
  .map(manifest => manifest.name)
  .sort();

try {
  const who = spawnSync('npm', ['whoami'], { encoding: 'utf8' });
  if (who.status !== 0) throw new Error('not signed in');
  console.log(`Signed in to npm as ${who.stdout.trim()}.`);
} catch {
  console.error('Not signed in to npm. Run `npm login` first.');
  process.exit(1);
}
console.log(
  `${packages.length} packages → ${REPOSITORY} ${FILE} environment=${ENVIRONMENT}\n`,
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    npm([
      'trust',
      'github',
      pkg,
      '--file',
      FILE,
      '--repository',
      REPOSITORY,
      '--environment',
      ENVIRONMENT,
      '--allow-publish',
      '--yes',
    ]);
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
