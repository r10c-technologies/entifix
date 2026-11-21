#!/usr/bin/env node
/**
 * Creates a new package's name on npm with a placeholder, and gives it the
 * trusted publisher every published package carries — so the next release can
 * publish its real version from CI, with provenance.
 *
 *   node tools/release/bootstrap-package.mjs --check            # which published packages npm does not have yet
 *   node tools/release/bootstrap-package.mjs                    # bootstrap every one of them
 *   node tools/release/bootstrap-package.mjs @entifix/docs-engine  # just these (also finishes a half-done one)
 *
 * Why it exists: npm refuses to configure a trusted publisher for a package that
 * does not exist — `npm trust github --allow-publish` answers `404` — so a new
 * package needs one publish by hand before CI can ever publish it (ADR 0003).
 * Run it after the pull request adding the package merges and **before**
 * approving the `npm-publish` environment on the release that first carries it,
 * or that release publishes every package but this one.
 *
 * The placeholder is `0.0.0-bootstrap.0` on the `bootstrap` dist-tag: a manifest
 * and a README, no code. npm also points `latest` at a package's first version,
 * so until the release lands `latest` is the placeholder; the release's publish
 * moves it. Nothing is built, so the checkout's state does not matter.
 *
 * Run it from a real terminal, not through a pipe: npm asks for two-factor
 * authentication in the browser (see `npm-terminal.mjs`). Each package costs a
 * publish and a trust write, so tick the option to skip two-factor
 * authentication for five minutes on the first prompt.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createTrust,
  describe,
  isTarget,
  listTrust,
  npm,
  requireLogin,
  sleep,
} from './npm-terminal.mjs';
import { publishedManifests } from './strip-source-condition.mjs';

export const PLACEHOLDER_VERSION = '0.0.0-bootstrap.0';
export const PLACEHOLDER_TAG = 'bootstrap';

/** The placeholder's manifest: the real one's identity, and nothing to run. */
export function placeholderManifest(manifest) {
  return {
    name: manifest.name,
    version: PLACEHOLDER_VERSION,
    description: `Placeholder reserving the name; install a released version of ${manifest.name}.`,
    license: manifest.license,
    repository: manifest.repository,
    publishConfig: { access: 'public' },
  };
}

const onRegistry = pkg =>
  spawnSync('npm', ['view', pkg, 'name'], { stdio: 'ignore' }).status === 0;

const publishPlaceholder = async manifest => {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrap-package-'));
  try {
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify(placeholderManifest(manifest), null, 2)}\n`,
    );
    writeFileSync(
      join(dir, 'README.md'),
      `# ${manifest.name}\n\nThis version only reserves the name on npm. Install a released version.\n`,
    );
    // `--provenance=false`: the repository's .npmrc requires provenance, which
    // only a CI run can sign. The placeholder is the one version without it.
    npm([
      'publish',
      dir,
      '--tag',
      PLACEHOLDER_TAG,
      '--access',
      'public',
      '--provenance=false',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The trust endpoint answers 404 until the registry serves the new name.
  for (let waited = 0; !onRegistry(manifest.name); waited += 5) {
    if (waited >= 120) {
      throw new Error(
        `${manifest.name} was published but the registry still does not serve it after 2 minutes. Run this script again with its name.`,
      );
    }
    await sleep(5000);
  }
};

const ensureTrust = async pkg => {
  const configs = listTrust(pkg);
  if (configs.length === 1 && isTarget(configs[0])) {
    console.log('    trusted publisher already in place');
    return;
  }
  if (configs.length > 0) {
    // The registry holds one configuration per package; replacing one is
    // narrow-trust's revoke → create, not a bootstrap.
    throw new Error(
      `${pkg} already trusts ${configs.map(describe).join('; ')}. Run tools/release/narrow-trust.mjs to replace it.`,
    );
  }
  createTrust(pkg);
  await sleep(2000);
  const after = listTrust(pkg);
  if (!(after.length === 1 && isTarget(after[0]))) {
    throw new Error(
      `${pkg}: expected exactly the target config after creating it, found ${after.map(describe).join('; ') || 'none'}`,
    );
  }
  console.log('    trusted publisher created and verified');
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const named = args.filter(arg => !arg.startsWith('--'));

  const manifests = new Map(
    publishedManifests(root).map(file => {
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      return [manifest.name, manifest];
    }),
  );
  const unknown = named.filter(name => !manifests.has(name));
  if (unknown.length > 0) {
    console.error(`Not a published package here: ${unknown.join(', ')}`);
    process.exit(1);
  }

  const targets =
    named.length > 0
      ? named
      : [...manifests.keys()].filter(pkg => !onRegistry(pkg)).sort();

  if (checkOnly) {
    if (targets.length === 0) console.log('npm has every published package.');
    for (const pkg of targets)
      console.log(`${pkg}: ${onRegistry(pkg) ? 'on npm' : 'not on npm'}`);
    process.exit(0);
  }
  if (targets.length === 0) {
    console.log('npm has every published package. Nothing to bootstrap.');
    process.exit(0);
  }

  requireLogin();
  for (const pkg of targets) {
    console.log(`● ${pkg}`);
    if (onRegistry(pkg)) {
      console.log('    already on npm — publishing nothing');
    } else {
      await publishPlaceholder(manifests.get(pkg));
      console.log(
        `    published ${PLACEHOLDER_VERSION} on '${PLACEHOLDER_TAG}'`,
      );
    }
    await ensureTrust(pkg);
  }
  console.log(
    `\nBootstrapped ${targets.length}. Approve the npm-publish environment on the release now.`,
  );
}
