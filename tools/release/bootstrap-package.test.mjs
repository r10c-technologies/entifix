import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PLACEHOLDER_VERSION,
  placeholderManifest,
} from './bootstrap-package.mjs';
import { isTarget, jsonObjectsIn } from './npm-terminal.mjs';

describe('placeholderManifest', () => {
  const real = {
    name: '@entifix/example',
    version: '1.2.3',
    license: 'MIT',
    repository: { type: 'git', url: 'git+https://example.test/repo.git' },
    exports: { '.': { '@entifix/source': './src/index.ts' } },
    dependencies: { effect: '4.0.7' },
    publishConfig: { access: 'public' },
  };

  it('keeps the identity and drops everything that would run', () => {
    assert.deepEqual(placeholderManifest(real), {
      name: '@entifix/example',
      version: PLACEHOLDER_VERSION,
      description:
        'Placeholder reserving the name; install a released version of @entifix/example.',
      license: 'MIT',
      repository: real.repository,
      publishConfig: { access: 'public' },
    });
  });

  it('is a prerelease, so no range a consumer writes resolves to it', () => {
    assert.match(PLACEHOLDER_VERSION, /^0\.0\.0-/);
  });
});

describe('a trust listing read from a terminal', () => {
  it('finds the configuration among prompts and escapes', () => {
    const transcript =
      '\x1b[2KAuthenticate in your browser…\r\n{\n  "id": "abc",\n  "type": "github",\n  "repository": "r10c-technologies/entifix",\n  "file": "release.yml",\n  "environment": "npm-publish"\n}\r\n';
    const [config] = jsonObjectsIn(transcript);
    assert.equal(config.id, 'abc');
    assert.equal(isTarget(config), true);
    assert.equal(isTarget({ ...config, environment: undefined }), false);
  });
});
