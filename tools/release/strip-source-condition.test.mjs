import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  hasSourceCondition,
  publishedManifests,
  stripAll,
  stripSourceCondition,
} from './strip-source-condition.mjs';

describe('stripSourceCondition', () => {
  it('drops the condition from every subpath and keeps the rest in order', () => {
    assert.deepEqual(
      stripSourceCondition({
        './package.json': './package.json',
        '.': {
          '@entifix/source': './src/index.ts',
          types: './dist/index.d.ts',
          import: './dist/index.js',
        },
        './mongo': {
          '@entifix/source': './src/mongo.ts',
          default: './dist/mongo.js',
        },
      }),
      {
        './package.json': './package.json',
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './mongo': { default: './dist/mongo.js' },
      },
    );
  });

  it('drops a subpath the condition was the only target of', () => {
    assert.deepEqual(
      stripSourceCondition({ './src': { '@entifix/source': './src/x.ts' } }),
      {},
    );
  });

  it('leaves strings, arrays and absent exports alone', () => {
    assert.equal(stripSourceCondition('./dist/index.js'), './dist/index.js');
    assert.equal(stripSourceCondition(undefined), undefined);
    assert.deepEqual(stripSourceCondition(['./a.js', { default: './b.js' }]), [
      './a.js',
      { default: './b.js' },
    ]);
  });
});

describe('stripAll', () => {
  let root;
  const write = (path, value) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  };
  const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'strip-source-'));
    write('packages/ts/core/package.json', {
      name: '@entifix/core',
      nx: { tags: ['tier:1'] },
      exports: {
        '.': {
          '@entifix/source': './src/index.ts',
          default: './dist/index.js',
        },
      },
    });
    write('packages/style/package.json', {
      name: '@entifix/style',
      nx: { tags: ['tier:0'] },
      exports: { '.': './src/index.css' },
    });
    write('packages/ts/private/package.json', {
      name: '@entifix/private',
      nx: { tags: ['type:testing'] },
      exports: { '.': { '@entifix/source': './src/index.ts' } },
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('rewrites only published manifests that carry the condition', () => {
    assert.deepEqual(
      publishedManifests(root).map(path => path.slice(root.length + 1)),
      ['packages/style/package.json', 'packages/ts/core/package.json'],
    );
    assert.deepEqual(
      stripAll(root).map(path => path.slice(root.length + 1)),
      ['packages/ts/core/package.json'],
    );
    assert.deepEqual(read('packages/ts/core/package.json').exports, {
      '.': { default: './dist/index.js' },
    });
    assert.equal(
      hasSourceCondition(read('packages/ts/private/package.json').exports),
      true,
    );
  });
});

describe('this repository', () => {
  it('publishes every tier package, and each strips clean', () => {
    const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
    const manifests = publishedManifests(root);
    assert.ok(manifests.length >= 23, `found only ${manifests.length}`);
    for (const manifest of manifests) {
      const { exports } = JSON.parse(readFileSync(manifest, 'utf8'));
      assert.equal(hasSourceCondition(stripSourceCondition(exports)), false);
    }
  });
});
