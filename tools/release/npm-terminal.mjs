/**
 * npm run attached to a terminal, and the trusted-publisher configuration every
 * published package must carry. Shared by `narrow-trust.mjs` and
 * `bootstrap-package.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REPOSITORY = 'r10c-technologies/entifix';
export const FILE = 'release.yml';
export const ENVIRONMENT = 'npm-publish';

const transcripts = mkdtempSync(join(tmpdir(), 'npm-terminal-'));
process.on('exit', () => rmSync(transcripts, { recursive: true, force: true }));

/**
 * Runs npm attached to the terminal. Output that has to be read back goes
 * through `script`, which records a pseudo-terminal session to a file, rather
 * than through a pipe: npm offers browser two-factor authentication only when
 * stdin **and** stdout are TTYs (`otplease` in npm's `lib/utils/auth.js`), and
 * with stdout piped it fails `EOTP` instead of asking — even for a read.
 */
export const npm = (args, { capture = false } = {}) => {
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
export const jsonObjectsIn = text => {
  // Terminal escapes and control characters are exactly what is being removed.
  /* eslint-disable no-control-regex */
  const clean = text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/[⠀-⣿]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  /* eslint-enable no-control-regex */
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

export const listTrust = pkg => {
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

/** Writes the one configuration a package should carry. */
export const createTrust = pkg =>
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

export const isTarget = config =>
  config.type === 'github' &&
  config.repository === REPOSITORY &&
  config.file === FILE &&
  config.environment === ENVIRONMENT &&
  // Absent when the registry omits it from the listing; present, it must allow publishing.
  (config.permissions === undefined ||
    config.permissions.includes('createPackage'));

export const describe = config =>
  `${config.type} ${config.repository ?? '?'} ${config.file ?? '?'} env=${config.environment ?? '(none)'} id=${config.id}`;

/** Exits unless npm has a signed-in user, and says who. */
export const requireLogin = () => {
  const who = spawnSync('npm', ['whoami'], { encoding: 'utf8' });
  if (who.status !== 0) {
    console.error('Not signed in to npm. Run `npm login` first.');
    process.exit(1);
  }
  console.log(`Signed in to npm as ${who.stdout.trim()}.`);
};

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
