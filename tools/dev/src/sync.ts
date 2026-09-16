import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
  files?: string[];
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
 * Marks the copy as not the release. It is not what makes a watcher rebuild — a
 * running webpack watch rebuilds on the file writes alone, measured — but
 * webpack's persistent cache snapshots a `node_modules` package by its version,
 * so an unchanged version would let a restarted build reuse the release's
 * modules.
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
 * Replaces one file by writing a sibling and renaming it over the original.
 *
 * pnpm imports a package by hard link or clone from its content-addressed
 * store. Writing through one of those files in place would rewrite the store's
 * copy, and with it every other project on the machine that links it. A rename
 * only ever replaces the directory entry.
 */
const replaceFile = (path: string, contents: Buffer | string) => {
  const staged = `${path}.sync-new`;
  writeFileSync(staged, contents);
  renameSync(staged, path);
};

/**
 * Makes `to` hold exactly what `from` holds, file by file.
 *
 * ⚠️ The directories themselves are kept, never swapped. Renaming a fresh `dist`
 * in over the old one was the first version of this, and a running webpack watch
 * never noticed: its watcher stays attached to the directory that was renamed
 * away. Replacing each file inside the directory it watches is what it sees.
 * Unchanged files are left alone, so a rebuild touching one module does not
 * announce every module as changed.
 */
const mirrorDirectory = (from: string, to: string) => {
  mkdirSync(to, { recursive: true });
  const wanted = new Set<string>();
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    // Build bookkeeping the tarball leaves out (`!**/*.tsbuildinfo`).
    if (entry.name.endsWith('.tsbuildinfo')) continue;
    wanted.add(entry.name);
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      mirrorDirectory(source, target);
      continue;
    }
    const contents = readFileSync(source);
    if (existsSync(target) && readFileSync(target).equals(contents)) continue;
    replaceFile(target, contents);
  }
  for (const name of readdirSync(to)) {
    if (!wanted.has(name))
      rmSync(join(to, name), { recursive: true, force: true });
  }
};

/**
 * The directories a package publishes, from its manifest's `files`.
 *
 * Read rather than assumed to be `dist`: `@entifix/style` has no build and
 * ships its CSS from `src`. Negations and plain files (`LICENSE`) are not
 * directories a build changes, so only the directories are mirrored.
 */
export const shippedDirectories = (manifest: Manifest): string[] =>
  (manifest.files ?? ['dist']).filter(entry => !entry.startsWith('!'));

/** Syncs one built package into every consumer. Returns the copies written. */
export const syncPackage = (
  pkg: SourcePackage,
  context: SyncContext,
): number => {
  const built = readManifest(pkg.dir);
  const shipped = shippedDirectories(built).filter(entry => {
    const path = join(pkg.dir, entry);
    return existsSync(path) && statSync(path).isDirectory();
  });
  if (shipped.length === 0) {
    throw new SyncError(
      `${pkg.name} has none of ${shippedDirectories(built).join(', ')} — build it first.`,
    );
  }
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
      for (const entry of shipped) {
        mirrorDirectory(join(pkg.dir, entry), join(copy, entry));
      }
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

/**
 * The virtual-store entries in `consumer` that hold a synced copy.
 *
 * The entry, not the package directory inside it: removing the whole
 * `.pnpm/@entifix+core@…` directory is what lets `pnpm install` put it back.
 */
export const syncedEntries = (consumer: string): string[] => {
  const store = join(consumer, 'node_modules', '.pnpm');
  return readdirSync(store)
    .filter(entry => entry.startsWith('@entifix+'))
    .filter(entry => {
      // `@entifix+core@0.1.1_effect@3.22.1` holds `@entifix/core` itself and,
      // beside it, links to the entifix packages core depends on. Only the
      // entry's own package decides: a link to a synced dependency does not make
      // this entry synced.
      const name = entry.slice('@entifix+'.length).split('@')[0];
      const dir = join(store, entry, 'node_modules', '@entifix', name);
      return (
        existsSync(join(dir, 'package.json')) &&
        'entifixDevSync' in readManifest(dir)
      );
    })
    .map(entry => join(store, entry))
    .sort();
};

/**
 * Puts every consumer back on the release it installs.
 *
 * ⚠️ `pnpm install --force` does not do this. pnpm 11's optimistic repeat
 * install sees unchanged manifests and a matching lockfile, answers "Already up
 * to date" in a fraction of a second, and leaves every synced copy in place. So
 * the synced entries are deleted, and the install that re-links them is told
 * not to be optimistic — about a second and a half, against four minutes for a
 * forced refetch of the whole tree.
 */
export const reset = (
  consumers: readonly string[],
  install: (consumer: string) => void,
  log: (line: string) => void,
): number => {
  let removed = 0;
  for (const consumer of consumers) {
    const entries = syncedEntries(consumer);
    if (entries.length === 0) {
      log(`nothing synced in ${basename(consumer)}`);
      continue;
    }
    for (const entry of entries)
      rmSync(entry, { recursive: true, force: true });
    install(consumer);
    log(`restored ${entries.length} synced entries in ${basename(consumer)}`);
    removed += entries.length;
  }
  return removed;
};
