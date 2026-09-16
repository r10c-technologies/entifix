import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Copies freshly built entifix packages into a consumer's installed copies.
 *
 * The consumer installs the published `@entifix/*` from the registry, and this
 * overwrites what pnpm put in its virtual store with the local build. Copy, not
 * symlink: a symlinked package resolves its own dependencies from entifix's
 * `node_modules`, which hands the consumer a second `effect` and breaks
 * `Context.Tag` identity without a word. A copy sitting in the consumer's
 * virtual store resolves its peers from the consumer, exactly as the published
 * tarball does.
 *
 * Manifests and lockfile are never touched, so nothing here can be committed by
 * accident; `pnpm install --force` in the consumer puts the release back.
 */

/** The subset of a `package.json` this reads and rewrites. */
export interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  entifixDevSync?: { source: string; at: string };
  [key: string]: unknown;
}

export interface SourcePackage {
  readonly name: string;
  readonly dir: string;
}

export interface SyncContext {
  readonly consumers: readonly string[];
  /** The entifix commit the build came from, recorded on every copy. */
  readonly source: string;
  readonly now: Date;
  readonly log: (line: string) => void;
}

export class SyncError extends Error {}

const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;

/**
 * `ENTIFIX_CONSUMERS`, split on `:` like `PATH`. No default: this repository is
 * public, and a baked-in sibling path is somebody's machine.
 */
export const parseConsumers = (value: string | undefined): string[] => {
  const consumers = (value ?? '').split(':').filter(path => path !== '');
  if (consumers.length === 0) {
    throw new SyncError(
      'ENTIFIX_CONSUMERS is not set. Point it at the repositories to sync into, ' +
        'separated by ":" — e.g. ENTIFIX_CONSUMERS=$PWD/../r10c',
    );
  }
  for (const consumer of consumers) {
    if (!existsSync(join(consumer, 'node_modules', '.pnpm'))) {
      throw new SyncError(
        `${consumer} has no node_modules/.pnpm — is it a pnpm install?`,
      );
    }
  }
  return consumers;
};

/**
 * Every publishable package under `packages/`, keyed by name.
 *
 * Walks rather than globbing a fixed depth, because `packages/style` sits one
 * level above `packages/ts/core`.
 */
export const sourcePackages = (root: string): Map<string, SourcePackage> => {
  const skip = new Set([
    'node_modules',
    'dist',
    'out-tsc',
    'test-output',
    'src',
  ]);
  const found = new Map<string, SourcePackage>();
  const walk = (dir: string) => {
    if (existsSync(join(dir, 'package.json'))) {
      const manifest = readManifest(dir);
      if (manifest.name && !manifest.private) {
        found.set(manifest.name, { name: manifest.name, dir });
      }
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !skip.has(entry.name)) {
        walk(join(dir, entry.name));
      }
    }
  };
  walk(join(root, 'packages'));
  return found;
};

/**
 * The installed copies of `name` in a consumer's virtual store.
 *
 * There can be more than one: pnpm keeps a directory per resolved peer set, so
 * `@entifix+core@0.1.1` and `@entifix+core@0.1.1_effect@3.22.1` are both the
 * same package, and a copy left stale is a copy some importer still loads.
 */
export const installedCopies = (consumer: string, name: string): string[] => {
  const store = join(consumer, 'node_modules', '.pnpm');
  const prefix = `${name.replace('/', '+')}@`;
  return readdirSync(store)
    .filter(entry => entry.startsWith(prefix))
    .map(entry => join(store, entry, 'node_modules', name))
    .filter(dir => existsSync(join(dir, 'package.json')))
    .sort();
};

/**
 * `0.1.1` or `0.1.1-dev.<earlier>` → `0.1.1-dev.<now>`.
 *
 * The version has to move. A bundler treats `node_modules` as managed — webpack
 * snapshots a package by the version in its manifest — so a copy that leaves
 * the version alone is a rebuild that never happens.
 */
export const devVersion = (installed: string, now: Date): string =>
  `${installed.replace(/-dev\.\d+$/, '')}-dev.${now.getTime()}`;

/**
 * Dependencies the build needs that the consumer never installed.
 *
 * A copy cannot install anything. A new dependency would resolve to nothing, or
 * worse to whatever an unrelated package hoisted, so it stops the sync instead.
 */
export const missingDependencies = (
  built: Manifest,
  installed: Manifest,
): string[] =>
  (['dependencies', 'peerDependencies'] as const).flatMap(field => {
    const have = new Set(Object.keys(installed[field] ?? {}));
    return Object.keys(built[field] ?? {})
      .filter(dep => !have.has(dep))
      .map(dep => `${dep} (${field})`);
  });

/**
 * Swap `from` in at `to` without writing into any file pnpm put there.
 *
 * pnpm imports a package by hard link or clone from its content-addressed
 * store. Writing through one of those files in place would rewrite the store's
 * copy, and with it every other project on the machine that links it. Renames
 * only ever replace directory entries.
 */
const replaceDirectory = (from: string, to: string) => {
  const staged = `${to}.sync-new`;
  const retired = `${to}.sync-old`;
  rmSync(staged, { recursive: true, force: true });
  rmSync(retired, { recursive: true, force: true });
  cpSync(from, staged, { recursive: true });
  if (existsSync(to)) renameSync(to, retired);
  renameSync(staged, to);
  rmSync(retired, { recursive: true, force: true });
};

const replaceFile = (path: string, contents: string) => {
  const staged = `${path}.sync-new`;
  writeFileSync(staged, contents);
  renameSync(staged, path);
};

/** Syncs one built package into every consumer. Returns the copies written. */
export const syncPackage = (
  pkg: SourcePackage,
  context: SyncContext,
): number => {
  const dist = join(pkg.dir, 'dist');
  if (!existsSync(dist)) {
    throw new SyncError(`${pkg.name} has no dist — build it first.`);
  }
  const built = readManifest(pkg.dir);
  let written = 0;

  for (const consumer of context.consumers) {
    const copies = installedCopies(consumer, pkg.name);
    if (copies.length === 0) {
      context.log(`skipped ${pkg.name}: not installed in ${consumer}`);
      continue;
    }
    let version = '';
    for (const copy of copies) {
      const installed = readManifest(copy);
      const missing = missingDependencies(built, installed);
      if (missing.length > 0) {
        throw new SyncError(
          `${pkg.name} now needs ${missing.join(', ')}, which ${consumer} never ` +
            'installed. A copy cannot install a dependency: publish a release ' +
            'and run `pnpm install` in the consumer.',
        );
      }
      version = devVersion(String(installed.version), context.now);
      replaceDirectory(dist, join(copy, 'dist'));
      const manifest: Manifest = {
        ...built,
        version,
        entifixDevSync: {
          source: context.source,
          at: context.now.toISOString(),
        },
      };
      replaceFile(
        join(copy, 'package.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      written += 1;
    }
    context.log(
      `synced ${pkg.name} → ${basename(consumer)} (${copies.length} ${
        copies.length === 1 ? 'copy' : 'copies'
      }, ${version})`,
    );
  }
  return written;
};

/**
 * Resolves the requested names (all publishable packages when none are given)
 * and syncs each. An unknown name is an error rather than a skip: `nx watch`
 * hands over exactly the projects it saw change.
 */
export const sync = (
  root: string,
  names: readonly string[],
  context: SyncContext,
): number => {
  const packages = sourcePackages(root);
  const selected =
    names.length === 0
      ? [...packages.values()]
      : names.map(name => {
          const pkg = packages.get(name);
          if (!pkg) {
            throw new SyncError(
              `${name} is not a publishable package under packages/.`,
            );
          }
          return pkg;
        });
  return selected.reduce((total, pkg) => total + syncPackage(pkg, context), 0);
};
