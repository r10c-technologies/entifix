import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  devVersion,
  installedCopies,
  linkedEntries,
  type Manifest,
  missingDependencies,
  parseConsumers,
  reset,
  sourcePackages,
  storeDirectoryOf,
  sync,
  syncedEntries,
  SyncError,
  syncPackage,
} from './sync.ts';

const writeJson = (path: string, value: unknown) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

const readJson = (path: string): Manifest =>
  JSON.parse(readFileSync(path, 'utf8')) as Manifest;

let scratch: string;
let entifix: string;
let consumer: string;
let lines: string[];

const context = (consumers = [consumer]) => ({
  consumers,
  source: 'abc1234',
  now: new Date('2026-09-16T12:00:00.000Z'),
  log: (line: string) => lines.push(line),
});

/** A built package in the fake entifix tree. */
const built = (dir: string, manifest: Manifest, file = 'index.js') => {
  writeJson(join(entifix, dir, 'package.json'), manifest);
  mkdirSync(join(entifix, dir, 'dist'), { recursive: true });
  writeFileSync(join(entifix, dir, 'dist', file), 'export const built = true;');
};

/** Records a dependency path as pnpm does for what it links. */
const linked = (depPath: string) =>
  appendFileSync(
    join(consumer, 'node_modules', '.pnpm', 'lock.yaml'),
    `  '${depPath}':\n    dependencies: {}\n\n`,
  );

/** The dependency path behind a fixture entry: `a+b@1_x` → `a/b@1(x)`. */
const depPathOf = (entry: string) =>
  entry.replace('+', '/').replace(/_(.+)$/, '($1)');

/**
 * An installed copy in the fake consumer's virtual store. An `orphan` is left
 * out of the lockfile, as pnpm leaves a previous release's directory behind.
 */
const installed = (
  entry: string,
  name: string,
  manifest: Manifest,
  { orphan = false } = {},
) => {
  if (!orphan) linked(depPathOf(entry));
  const dir = join(
    consumer,
    'node_modules',
    '.pnpm',
    entry,
    'node_modules',
    name,
  );
  writeJson(join(dir, 'package.json'), manifest);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'dist', 'index.js'),
    'export const published = true;',
  );
  return dir;
};

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'dev-sync-'));
  entifix = join(scratch, 'entifix');
  consumer = join(scratch, 'r10c');
  mkdirSync(join(consumer, 'node_modules', '.pnpm'), { recursive: true });
  writeFileSync(
    join(consumer, 'node_modules', '.pnpm', 'lock.yaml'),
    "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n\nsnapshots:\n\n",
  );
  lines = [];
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe('parseConsumers', () => {
  it('refuses to run without a consumer', () => {
    expect(() => parseConsumers(undefined)).toThrow(
      /ENTIFIX_CONSUMERS is not set/,
    );
    expect(() => parseConsumers('::')).toThrow(SyncError);
  });

  it('refuses a path that is not a pnpm install', () => {
    expect(() => parseConsumers(`${consumer}:${scratch}`)).toThrow(
      /has no node_modules\/\.pnpm/,
    );
  });

  it('splits on ":" like PATH', () => {
    expect(parseConsumers(`${consumer}:`)).toEqual([consumer]);
  });
});

describe('sourcePackages', () => {
  it('finds packages at any depth and leaves out private ones', () => {
    built('packages/ts/core', { name: '@entifix/core', version: '0.1.1' });
    built('packages/style', { name: '@entifix/style', version: '0.1.1' });
    built('packages/ts/internal', { name: '@entifix/internal', private: true });
    writeJson(join(entifix, 'packages/ts/unnamed/package.json'), {});
    // A generated manifest under a skipped directory is not a package.
    writeJson(
      join(entifix, 'packages/ts/core/../x/node_modules/y/package.json'),
      {
        name: '@entifix/stray',
      },
    );

    expect([...sourcePackages(entifix).keys()].sort()).toEqual([
      '@entifix/core',
      '@entifix/style',
    ]);
  });
});

describe('installedCopies', () => {
  it('returns one directory per peer set, and ignores look-alike names', () => {
    const plain = installed('@entifix+core@0.1.1', '@entifix/core', {});
    const peered = installed(
      '@entifix+core@0.1.1_effect@3.22.1',
      '@entifix/core',
      {},
    );
    installed('@entifix+core-extra@0.1.1', '@entifix/core-extra', {});
    mkdirSync(join(consumer, 'node_modules/.pnpm/@entifix+core@0.0.1'), {
      recursive: true,
    });

    expect(installedCopies(consumer, '@entifix/core')).toEqual([plain, peered]);
  });

  it('skips a directory pnpm no longer links', () => {
    const live = installed('@entifix+core@0.1.2', '@entifix/core', {});
    installed('@entifix+core@0.1.1', '@entifix/core', {}, { orphan: true });

    expect(installedCopies(consumer, '@entifix/core')).toEqual([live]);
  });

  it('finds a directory whose name pnpm cut and hashed', () => {
    const depPath = `@entifix/mongo@0.2.0(@entifix/transactions@0.2.0(effect@4.0.5))(${'x'.repeat(80)}@1.0.0)`;
    const entry = storeDirectoryOf(depPath);
    linked(depPath);
    const copy = installed(
      entry,
      '@entifix/mongo',
      {},
      {
        orphan: true,
      },
    );

    expect(entry).toMatch(/^@entifix\+mongo@0\.2\.0_.{66}_[0-9a-f]{32}$/);
    expect(installedCopies(consumer, '@entifix/mongo')).toEqual([copy]);
  });

  it('refuses a consumer with no lockfile of what it installed', () => {
    rmSync(join(consumer, 'node_modules/.pnpm/lock.yaml'));

    expect(() => installedCopies(consumer, '@entifix/core')).toThrow(
      /has no node_modules\/\.pnpm\/lock\.yaml/,
    );
  });

  it('reads the length limit pnpm recorded', () => {
    writeFileSync(
      join(consumer, 'node_modules/.modules.yaml'),
      '{\n  "virtualStoreDirMaxLength": 60\n}\n',
    );
    const depPath = '@entifix/core@0.2.0(effect@4.0.5)(typescript@5.9.3)';
    linked(depPath);
    const copy = installed(
      storeDirectoryOf(depPath, 60),
      '@entifix/core',
      {},
      { orphan: true },
    );

    expect(installedCopies(consumer, '@entifix/core')).toEqual([copy]);
  });
});

describe('linkedEntries', () => {
  it('uses the default limit when .modules.yaml records none', () => {
    writeFileSync(join(consumer, 'node_modules/.modules.yaml'), '{}\n');
    linked('@entifix/core@0.2.0');

    expect([...linkedEntries(consumer)]).toEqual(['@entifix+core@0.2.0']);
  });

  it('links nothing from a lockfile with no snapshots', () => {
    writeFileSync(
      join(consumer, 'node_modules/.pnpm/lock.yaml'),
      "lockfileVersion: '9.0'\n",
    );

    expect([...linkedEntries(consumer)]).toEqual([]);
  });
});

describe('storeDirectoryOf', () => {
  it('flattens peers the way pnpm names the directory', () => {
    expect(
      storeDirectoryOf(
        '@entifix/mongo@0.2.0(@entifix/transactions@0.2.0(effect@4.0.5))(effect@4.0.5)',
      ),
    ).toBe(
      '@entifix+mongo@0.2.0_@entifix+transactions@0.2.0_effect@4.0.5__effect@4.0.5',
    );
  });

  it('hashes a name with upper case, as pnpm does', () => {
    expect(storeDirectoryOf('@entifix/core@0.2.0(Peer@1.0.0)')).toMatch(
      /^@entifix\+core@0\.2\.0_Peer@1\.0\.0_[0-9a-f]{32}$/,
    );
  });

  it('leaves a path with no version alone', () => {
    expect(storeDirectoryOf('@entifix/core')).toBe('@entifix+core');
  });
});

describe('syncPackage with an orphaned copy', () => {
  it('writes the live copy and ignores an orphan whose dependencies differ', () => {
    built('packages/ts/transactions', {
      name: '@entifix/transactions',
      version: '0.1.2',
      dependencies: { '@entifix/business': '0.1.2' },
    });
    const live = installed(
      '@entifix+transactions@0.1.2',
      '@entifix/transactions',
      {
        version: '0.1.2',
        dependencies: { '@entifix/business': '0.1.2' },
      },
    );
    const orphan = installed(
      '@entifix+transactions@0.1.1',
      '@entifix/transactions',
      { version: '0.1.1' },
      { orphan: true },
    );

    expect(
      syncPackage(
        {
          name: '@entifix/transactions',
          dir: join(entifix, 'packages/ts/transactions'),
        },
        context(),
      ),
    ).toBe(1);
    expect(readJson(join(live, 'package.json')).entifixDevSync).toBeDefined();
    expect(
      readJson(join(orphan, 'package.json')).entifixDevSync,
    ).toBeUndefined();
  });
});

describe('devVersion', () => {
  const now = new Date(1_000);

  it('suffixes a release', () => {
    expect(devVersion('0.1.1', now)).toBe('0.1.1-dev.1000');
  });

  it('replaces an earlier sync rather than stacking on it', () => {
    expect(devVersion('0.1.1-dev.42', now)).toBe('0.1.1-dev.1000');
  });
});

describe('missingDependencies', () => {
  it('names each dependency the consumer never installed', () => {
    expect(
      missingDependencies(
        {
          dependencies: { '@swc/helpers': '1', idb: '8' },
          peerDependencies: { effect: '3', react: '19' },
        },
        {
          dependencies: { '@swc/helpers': '1' },
          peerDependencies: { effect: '3' },
        },
      ),
    ).toEqual(['idb (dependencies)', 'react (peerDependencies)']);
  });

  it('is satisfied by a manifest with no dependencies at all', () => {
    expect(missingDependencies({}, {})).toEqual([]);
  });
});

describe('syncPackage', () => {
  const core = () => ({
    name: '@entifix/core',
    dir: join(entifix, 'packages/ts/core'),
  });

  it('refuses a package that was never built', () => {
    built('packages/ts/core', { name: '@entifix/core', version: '0.1.1' });
    rmSync(join(entifix, 'packages/ts/core/dist'), { recursive: true });

    expect(() => syncPackage(core(), context())).toThrow(
      /has none of dist — build it first/,
    );
  });

  it('replaces dist and stamps the manifest in every copy', () => {
    built(
      'packages/ts/core',
      {
        name: '@entifix/core',
        version: '0.1.1',
        peerDependencies: { effect: '3' },
      },
      'fresh.js',
    );
    const copies = [
      installed('@entifix+core@0.1.1', '@entifix/core', {
        version: '0.1.1',
        peerDependencies: { effect: '3' },
      }),
      installed('@entifix+core@0.1.1_x', '@entifix/core', {
        version: '0.1.1-dev.5',
        peerDependencies: { effect: '3' },
      }),
    ];

    expect(syncPackage(core(), context())).toBe(2);

    for (const copy of copies) {
      expect(readdirSync(join(copy, 'dist'))).toEqual(['fresh.js']);
      expect(readJson(join(copy, 'package.json'))).toMatchObject({
        name: '@entifix/core',
        version: `0.1.1-dev.${Date.parse('2026-09-16T12:00:00.000Z')}`,
        entifixDevSync: { source: 'abc1234', at: '2026-09-16T12:00:00.000Z' },
      });
      // Nothing staged or retired is left beside the copy.
      expect(readdirSync(copy).sort()).toEqual(['dist', 'package.json']);
    }
    expect(lines).toEqual([
      expect.stringMatching(/synced @entifix\/core → r10c \(2 copies/),
    ]);
  });

  it('mirrors a rebuild file by file: new, changed, removed and unchanged', () => {
    built('packages/ts/core', { name: '@entifix/core', version: '0.1.1' });
    const source = join(entifix, 'packages/ts/core/dist');
    mkdirSync(join(source, 'nested'), { recursive: true });
    writeFileSync(join(source, 'nested', 'kept.js'), 'same');
    writeFileSync(join(source, 'tsconfig.lib.tsbuildinfo'), '{}');
    const copy = installed('@entifix+core@0.1.1', '@entifix/core', {
      version: '0.1.1',
    });
    mkdirSync(join(copy, 'dist', 'nested'), { recursive: true });
    writeFileSync(join(copy, 'dist', 'nested', 'kept.js'), 'same');
    writeFileSync(join(copy, 'dist', 'stale.js'), 'gone in the rebuild');
    const kept = statSync(join(copy, 'dist', 'nested', 'kept.js')).ino;

    syncPackage(core(), context());

    expect(readdirSync(join(copy, 'dist')).sort()).toEqual([
      'index.js',
      'nested',
    ]);
    expect(readFileSync(join(copy, 'dist', 'index.js'), 'utf8')).toBe(
      'export const built = true;',
    );
    // Untouched rather than rewritten, so a watcher hears only what changed.
    expect(statSync(join(copy, 'dist', 'nested', 'kept.js')).ino).toBe(kept);
  });

  it('syncs what the manifest ships, not only dist', () => {
    writeJson(join(entifix, 'packages/style/package.json'), {
      name: '@entifix/style',
      version: '0.1.1',
      files: ['src', '!**/*.map', 'LICENSE'],
    });
    mkdirSync(join(entifix, 'packages/style/src'), { recursive: true });
    writeFileSync(join(entifix, 'packages/style/src/tokens.css'), ':root{}');
    writeFileSync(join(entifix, 'packages/style/LICENSE'), 'MIT');
    const copy = installed('@entifix+style@0.1.1', '@entifix/style', {
      version: '0.1.1',
    });

    syncPackage(
      { name: '@entifix/style', dir: join(entifix, 'packages/style') },
      context(),
    );

    expect(readFileSync(join(copy, 'src', 'tokens.css'), 'utf8')).toBe(
      ':root{}',
    );
  });

  it('writes dist into a copy that had none', () => {
    built('packages/ts/core', { name: '@entifix/core', version: '0.1.1' });
    const copy = installed('@entifix+core@0.1.1', '@entifix/core', {
      version: '0.1.1',
    });
    rmSync(join(copy, 'dist'), { recursive: true });

    syncPackage(core(), context());

    expect(existsSync(join(copy, 'dist', 'index.js'))).toBe(true);
    expect(lines).toEqual([expect.stringMatching(/\(1 copy, /)]);
  });

  it('skips a consumer that does not install the package', () => {
    built('packages/ts/core', { name: '@entifix/core', version: '0.1.1' });

    expect(syncPackage(core(), context())).toBe(0);
    expect(lines).toEqual([
      `skipped @entifix/core: not installed in ${consumer}`,
    ]);
  });

  it('stops on a dependency the consumer never installed, before writing', () => {
    built('packages/ts/core', {
      name: '@entifix/core',
      version: '0.1.1',
      dependencies: { idb: '8' },
    });
    const copy = installed('@entifix+core@0.1.1', '@entifix/core', {
      version: '0.1.1',
    });

    expect(() => syncPackage(core(), context())).toThrow(
      /now needs idb \(dependencies\).*publish a release/,
    );
    expect(readdirSync(join(copy, 'dist'))).toEqual(['index.js']);
    expect(readJson(join(copy, 'package.json')).version).toBe('0.1.1');
  });
});

describe('sync', () => {
  beforeEach(() => {
    built('packages/ts/core', { name: '@entifix/core', version: '0.1.1' });
    built('packages/style', { name: '@entifix/style', version: '0.1.1' });
    installed('@entifix+core@0.1.1', '@entifix/core', { version: '0.1.1' });
    installed('@entifix+style@0.1.1', '@entifix/style', { version: '0.1.1' });
  });

  it('syncs every publishable package when none is named', () => {
    expect(sync(entifix, [], context())).toBe(2);
  });

  it('syncs only the named packages', () => {
    expect(sync(entifix, ['@entifix/style'], context())).toBe(1);
  });

  it('rejects a name that is not a publishable package', () => {
    expect(() => sync(entifix, ['@entifix/docs-check'], context())).toThrow(
      /@entifix\/docs-check is not a publishable package/,
    );
  });
});

describe('reset', () => {
  it('removes only synced entries, then reinstalls each consumer that had any', () => {
    built('packages/ts/core', { name: '@entifix/core', version: '0.1.1' });
    installed('@entifix+core@0.1.1', '@entifix/core', { version: '0.1.1' });
    installed('@entifix+core@0.1.1_x', '@entifix/core', { version: '0.1.1' });
    installed('@entifix+rest@0.1.1', '@entifix/rest', { version: '0.1.1' });
    mkdirSync(join(consumer, 'node_modules/.pnpm/@entifix+sql@0.1.1'), {
      recursive: true,
    });
    mkdirSync(
      join(
        consumer,
        'node_modules/.pnpm/@entifix+jwt@0.1.1/node_modules/@entifix/jwt',
      ),
      {
        recursive: true,
      },
    );
    mkdirSync(join(consumer, 'node_modules/.pnpm/effect@3.22.1'), {
      recursive: true,
    });
    sync(entifix, ['@entifix/core'], context());
    // An entry whose own package is a release, beside a link to synced core.
    cpSync(
      join(
        consumer,
        'node_modules/.pnpm/@entifix+core@0.1.1/node_modules/@entifix/core',
      ),
      join(
        consumer,
        'node_modules/.pnpm/@entifix+rest@0.1.1/node_modules/@entifix/core',
      ),
      { recursive: true },
    );

    const store = join(consumer, 'node_modules/.pnpm');
    expect(syncedEntries(consumer)).toEqual([
      join(store, '@entifix+core@0.1.1'),
      join(store, '@entifix+core@0.1.1_x'),
    ]);

    const installs: string[] = [];
    expect(
      reset(
        [consumer],
        dir => installs.push(dir),
        line => lines.push(line),
      ),
    ).toBe(2);
    expect(installs).toEqual([consumer]);
    expect(existsSync(join(store, '@entifix+core@0.1.1'))).toBe(false);
    expect(existsSync(join(store, '@entifix+rest@0.1.1'))).toBe(true);
    expect(lines.at(-1)).toBe('restored 2 synced entries in r10c');
  });

  it('leaves a consumer with nothing synced alone', () => {
    const installs: string[] = [];
    expect(
      reset(
        [consumer],
        dir => installs.push(dir),
        line => lines.push(line),
      ),
    ).toBe(0);
    expect(installs).toEqual([]);
    expect(lines).toEqual(['nothing synced in r10c']);
  });
});
