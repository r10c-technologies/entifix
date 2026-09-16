import { describe, expect, it } from 'vitest';

import { readManifest } from './manifests.js';
import { ALWAYS_SHIPPED, exportTargets, shipsFile } from './packaging.js';
import { PACKAGES } from './registry.js';

const REPOSITORY_URL = 'git+https://github.com/r10c-technologies/entifix.git';

/** Every path the manifest promises a consumer, `files` aside. */
const promisedFiles = (dir: string): string[] => {
  const manifest = readManifest(dir);
  return [
    ...new Set(
      [
        ...exportTargets(manifest.exports),
        manifest.main,
        manifest.module,
        manifest.types,
      ].filter(
        (target): target is string =>
          typeof target === 'string' && !ALWAYS_SHIPPED.has(target),
      ),
    ),
  ].sort();
};

describe('A package ships what it points at', () => {
  it('declares a files allowlist', () => {
    for (const pkg of PACKAGES) {
      expect(
        readManifest(pkg.dir).files ?? [],
        `${pkg.name} declares no 'files', so its tarball is whatever npm ` +
          'decides to sweep up',
      ).not.toEqual([]);
    }
  });

  it('covers every path its exports, main, module and types name', () => {
    for (const pkg of PACKAGES) {
      const files = readManifest(pkg.dir).files ?? [];
      const missing = promisedFiles(pkg.dir).filter(
        target => !shipsFile(files, target),
      );

      expect(
        missing,
        `${pkg.name} points a consumer at files its 'files' allowlist does ` +
          `not ship:\n  ${missing.join('\n  ')}\n` +
          `'files' is ${JSON.stringify(files)}. Publishing this succeeds and ` +
          'the package is unusable — npm force-includes the file `main` ' +
          'names, so the import resolves, the types do not, and any second ' +
          'subpath is simply absent.',
      ).toEqual([]);
    }
  });

  it('ships its LICENSE', () => {
    for (const pkg of PACKAGES) {
      expect(
        shipsFile(readManifest(pkg.dir).files ?? [], 'LICENSE'),
        `${pkg.name} does not ship a LICENSE. npm packs per package, so the ` +
          'repository root file never reaches a sub-package tarball, and MIT ' +
          'grants nothing without its text ' +
          '([ADR 0002](../../../docs/adr/0002-entifix-is-mit.md))',
      ).toBe(true);
    }
  });
});

describe('A package can be published at all', () => {
  it('is not private', () => {
    const withheld = PACKAGES.filter(
      pkg => readManifest(pkg.dir).private === true,
    ).map(pkg => pkg.name);

    expect(
      withheld,
      "these carry 'private: true', so a release publishes every other " +
        'package and skips them — leaving adopters unable to resolve ' +
        `packages the rest hard-depend on:\n  ${withheld.join('\n  ')}`,
    ).toEqual([]);
  });

  it('opts into public access', () => {
    for (const pkg of PACKAGES) {
      expect(
        readManifest(pkg.dir).publishConfig?.access,
        `${pkg.name} is scoped, and a scoped package defaults to restricted. ` +
          'Without this the registry answers 402 Payment Required',
      ).toBe('public');
    }
  });

  it('names its own directory, so provenance resolves', () => {
    for (const pkg of PACKAGES) {
      const repository = readManifest(pkg.dir).repository;

      expect(repository?.url, `${pkg.name} declares no repository url`).toBe(
        REPOSITORY_URL,
      );
      expect(
        repository?.directory,
        `${pkg.name} points provenance at the wrong directory`,
      ).toBe(pkg.dir);
    }
  });

  it('carries one version across the register', () => {
    const versions = [
      ...new Set(PACKAGES.map(pkg => readManifest(pkg.dir).version)),
    ];

    expect(
      versions,
      'entifix versions fixed — every package moves together, so a second ' +
        'version in the tree is a release that stopped half way ' +
        `([ADR 0001](../../../docs/adr/0001-the-tier-contract-and-the-host-seam.md)):\n  ${versions.join(
          '\n  ',
        )}`,
    ).toHaveLength(1);
  });
});
