import { join } from 'node:path';

import { ENTIFIX_AREAS } from '@entifix/docs/reader';
import {
  createDocsSite,
  guidesSource,
  recordsSource,
  referenceKind,
  referenceSource,
} from '@entifix/docs-engine';

import { packagePages, publishedPackages } from './packages';

const REPOSITORY = 'https://github.com/r10c-technologies/entifix/blob/main';

/**
 * The records this site shows are the ones installed with `@entifix/docs` —
 * the decisions as they stood at the installed release, never a clone
 * (ADR 0031 §1).
 */
const RECORDS = join(process.cwd(), 'node_modules/@entifix/docs/records');

/** Every package a page may cite: each one entifix publishes. */
const PACKAGES = publishedPackages();

const records = recordsSource({
  directory: RECORDS,
  areas: ENTIFIX_AREAS,
  title: 'Decision records',
  links: {
    record: (id, anchor) => `/records/${id}/${anchor ? `#${anchor}` : ''}`,
    file: (path, anchor) =>
      `${REPOSITORY}/docs/adr/${path}${anchor ? `#${anchor}` : ''}`,
  },
});

export const site = createDocsSite({
  baseUrl: '/',
  sources: [
    guidesSource({
      directory: join(process.cwd(), 'content/guides'),
      title: 'Guides',
    }),
    records,
    referenceSource('packages', 'Packages', packagePages),
  ],
  references: {
    record: referenceKind(
      records.pages.map(page => page.record?.id ?? ''),
      id => `/records/${id}/`,
      id => `ADR ${id}`,
    ),
    package: referenceKind(
      PACKAGES.map(({ manifest }) => manifest.name),
      name => `/packages/${name.replace(/^@entifix\//, '')}/`,
      name => name,
    ),
  },
});

/** The palettes a reader may pick, and the ones fumadocs treats as dark. */
export const THEME_IDS = ['aurora', 'midnight'] as const;
export const DARK_PALETTES = ['midnight'];
