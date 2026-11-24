import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { ReferencePage } from '@entifix/docs-engine';

/** The repository root: two folders above this app. */
const ROOT = join(process.cwd(), '../..');
const PACKAGES = join(ROOT, 'packages');
const REPOSITORY = 'https://github.com/r10c-technologies/entifix/blob/main';

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly private?: boolean;
  readonly exports?: Record<string, unknown>;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  readonly nx?: { readonly tags?: readonly string[] };
}

/** One published package, read from its own manifest. */
export interface PublishedPackage {
  readonly manifest: PackageManifest;
  /** Its folder under the repository root: `packages/ts/core`. */
  readonly folder: string;
  /** Its page under `/packages/`: the name without the scope. */
  readonly slug: string;
}

/** Every `package.json` under `packages/`, at any depth, `node_modules` skipped. */
function manifestsUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(directory, entry);
    if (!statSync(path).isDirectory()) continue;
    const manifest = join(path, 'package.json');
    try {
      statSync(manifest);
      found.push(manifest);
    } catch {
      found.push(...manifestsUnder(path));
    }
  }
  return found;
}

/**
 * Every package entifix publishes, read from the repository rather than from a
 * list: a package that is published has a page, because nothing has to
 * remember to add it. A private package — a tool, a fixture — has none.
 */
export const publishedPackages = (): readonly PublishedPackage[] =>
  manifestsUnder(PACKAGES)
    .map(path => ({
      manifest: JSON.parse(readFileSync(path, 'utf8')) as PackageManifest,
      folder: relative(ROOT, join(path, '..')),
    }))
    .filter(({ manifest }) => manifest.private !== true)
    .map(entry => ({
      ...entry,
      slug: entry.manifest.name.replace(/^@entifix\//, ''),
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));

/** `tier:2` → `2`, or the tier the package declares none of. */
const tierOf = (manifest: PackageManifest): string =>
  manifest.nx?.tags
    ?.find(tag => tag.startsWith('tier:'))
    ?.slice('tier:'.length) ?? '—';

const row = (...cells: string[]) => `| ${cells.join(' | ')} |`;

/** One package's page: what it is, what it exposes, and what it needs. */
function pageOf({ manifest, folder, slug }: PublishedPackage): ReferencePage {
  const entries = Object.keys(manifest.exports ?? { '.': true }).filter(
    entry => entry !== './package.json',
  );
  const internal = Object.keys(manifest.dependencies ?? {}).filter(name =>
    name.startsWith('@entifix/'),
  );
  const peers = Object.entries(manifest.peerDependencies ?? {}).map(
    ([name, range]) =>
      row(
        `\`${name}\``,
        `\`${range}\``,
        manifest.peerDependenciesMeta?.[name]?.optional === true
          ? 'optional'
          : 'required',
      ),
  );
  const markdown = [
    manifest.description ?? '',
    '',
    row('Version', 'Tier', 'Source'),
    row('---', '---', '---'),
    row(
      `\`${manifest.version}\``,
      tierOf(manifest),
      `[${folder}](${REPOSITORY}/${folder})`,
    ),
    '',
    '## Entry points',
    '',
    ...entries.map(
      entry =>
        `- \`${entry === '.' ? manifest.name : `${manifest.name}/${entry.replace(/^\.\//, '')}`}\``,
    ),
    '',
    '## Depends on',
    '',
    internal.length === 0
      ? 'No other entifix package.'
      : internal.map(name => `- :package[${name}]`).join('\n'),
    ...(peers.length === 0
      ? []
      : [
          '',
          '## Peer dependencies',
          '',
          'An optional peer is a capability the package is adoptable without; it is needed only by the subpath that uses it.',
          '',
          row('Package', 'Range', 'Needed'),
          row('---', '---', '---'),
          ...peers,
        ]),
    '',
  ].join('\n');
  return {
    path: [slug],
    title: manifest.name,
    description: manifest.description,
    markdown,
    file: join(folder, 'package.json'),
  };
}

/** The index: every package by tier, then name. */
function indexOf(packages: readonly PublishedPackage[]): ReferencePage {
  const markdown = [
    'Every package entifix publishes, read from its own `package.json`. A tier may depend only on its own tier or below (ADR :record[0001]).',
    '',
    row('Package', 'Tier', 'What it is'),
    row('---', '---', '---'),
    ...[...packages]
      .sort(
        (left, right) =>
          tierOf(left.manifest).localeCompare(tierOf(right.manifest)) ||
          left.slug.localeCompare(right.slug),
      )
      .map(({ manifest }) =>
        row(
          `:package[${manifest.name}]`,
          tierOf(manifest),
          manifest.description ?? '',
        ),
      ),
    '',
  ].join('\n');
  return {
    path: [],
    title: 'Packages',
    description: 'The package reference.',
    markdown,
    file: 'packages',
  };
}

/** The reference pages: the index, then one page per published package. */
export const packagePages = (): readonly ReferencePage[] => {
  const packages = publishedPackages();
  return [indexOf(packages), ...packages.map(pageOf)];
};
