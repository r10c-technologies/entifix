import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  devVersion,
  installedCopies,
  type Manifest,
  missingDependencies,
  parseConsumers,
  sourcePackages,
  sync,
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

/** An installed copy in the fake consumer's virtual store. */
const installed = (entry: string, name: string, manifest: Manifest) => {
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
    expect(() => syncPackage(core(), context())).toThrow(/has no dist/);
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
