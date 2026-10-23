#!/usr/bin/env node
/**
 * Removes the workspace-only `@entifix/source` export condition from every
 * published package's manifest, right before `nx release publish` packs them.
 *
 *   node tools/release/strip-source-condition.mjs
 *
 * Inside this repository the condition is correct: it points each package at
 * its own `src/index.ts`, so specs and examples run without a build. The
 * tarball ships `dist` and not `src`, so in a published manifest the same line
 * names a file that does not exist — and a consumer whose toolchain sets the
 * condition (as the original host's did while entifix lived in its tree)
 * resolves every
 * `@entifix/*` import to nothing (#32).
 *
 * It rewrites the checkout the release job publishes from, never a commit: the
 * job is discarded afterwards, and the workspace keeps resolving to source.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_CONDITION = '@entifix/source';

/**
 * `exports` without the source condition, at any depth. A subpath whose only
 * target was that condition is dropped with it rather than left empty.
 */
export function stripSourceCondition(exports) {
  if (exports === null || typeof exports !== 'object') return exports;
  if (Array.isArray(exports)) return exports.map(stripSourceCondition);
  const stripped = {};
  for (const [key, value] of Object.entries(exports)) {
    if (key === SOURCE_CONDITION) continue;
    const next = stripSourceCondition(value);
    if (
      next !== null &&
      typeof next === 'object' &&
      Object.keys(next).length === 0
    ) {
      continue;
    }
    stripped[key] = next;
  }
  return stripped;
}

/** Whether a value still names the source condition anywhere. */
export function hasSourceCondition(exports) {
  if (exports === null || typeof exports !== 'object') return false;
  return Object.entries(exports).some(
    ([key, value]) => key === SOURCE_CONDITION || hasSourceCondition(value),
  );
}

/**
 * Every manifest `nx release` publishes: the ones tagged with a tier, which is
 * the `release.projects` filter in `nx.json`.
 */
export function publishedManifests(root) {
  const found = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      const manifest = join(path, 'package.json');
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
        if ((parsed.nx?.tags ?? []).some(tag => tag.startsWith('tier:'))) {
          found.push(manifest);
          continue;
        }
      } catch {
        // No manifest here; look one level further down.
      }
      walk(path);
    }
  };
  walk(join(root, 'packages'));
  return found.sort();
}

/** Strips every published manifest under `root`; returns the paths rewritten. */
export function stripAll(root) {
  const rewritten = [];
  for (const manifest of publishedManifests(root)) {
    const text = readFileSync(manifest, 'utf8');
    const parsed = JSON.parse(text);
    if (!hasSourceCondition(parsed.exports)) continue;
    parsed.exports = stripSourceCondition(parsed.exports);
    writeFileSync(manifest, `${JSON.stringify(parsed, null, 2)}\n`);
    rewritten.push(manifest);
  }
  return rewritten;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
  const rewritten = stripAll(root);
  const left = publishedManifests(root).filter(manifest =>
    hasSourceCondition(JSON.parse(readFileSync(manifest, 'utf8')).exports),
  );
  if (left.length > 0) {
    console.error(
      `Still carrying ${SOURCE_CONDITION}:\n  ${left.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(
    `Stripped ${SOURCE_CONDITION} from ${rewritten.length} published manifests.`,
  );
}
