import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { readRecords, type RecordEntry } from '@entifix/docs/reader';
import { frontmatter } from 'fumadocs-core/content/md/frontmatter';

import { DocsContentError } from './errors.js';
import { type LinkTargets, rewriteLinks } from './links.js';

/** One page a source contributes, before the engine checks and renders it. */
export interface DocsPageInput {
  /** Its address under the site's base URL: `['records', '0031']`. */
  readonly slugs: readonly string[];
  readonly title: string;
  readonly description?: string;
  /** The body, in Markdown with the engine's directives. */
  readonly markdown: string;
  /** Where it came from, for an error. */
  readonly file: string;
  /** The record it was read from, for a records page. */
  readonly record?: RecordEntry;
}

/**
 * A section of the site: the pages one source contributes, under one folder,
 * in the order the sidebar shows them.
 */
export interface DocsSource {
  /** The folder its pages sit in, the first slug of each: `records`. */
  readonly folder: string;
  /** The folder's caption in the sidebar. */
  readonly title: string;
  readonly pages: readonly DocsPageInput[];
}

export interface RecordsSourceOptions {
  /** The collection: a directory of `NNNN-*.md` records. */
  readonly directory: string;
  /** The areas a record may be filed under. */
  readonly areas: readonly string[];
  readonly folder?: string;
  readonly title: string;
  /** Where a record's relative links go. */
  readonly links: LinkTargets;
}

const RECORD_TITLE = /^#\s+\d+\.\s+/;

/**
 * Every record of a collection, one page each, read with
 * `@entifix/docs/reader` — the one parser (entifix ADR 0031 §1). A collection
 * the reader finds problems in is not a site: the problems stop the build.
 */
export const recordsSource = ({
  directory,
  areas,
  folder = 'records',
  title,
  links,
}: RecordsSourceOptions): DocsSource => {
  const { records, problems } = readRecords(directory, { areas });
  if (problems.length > 0) {
    throw new DocsContentError(directory, problems.join('; '));
  }
  return {
    folder,
    title,
    pages: records.map(record => {
      const file = join(directory, record.file);
      const [, ...body] = readFileSync(file, 'utf8').split('\n');
      return {
        slugs: [folder, record.id],
        title: `${record.number}. ${record.title.replace(RECORD_TITLE, '')}`,
        markdown: rewriteLinks(body.join('\n'), links),
        file,
        record,
      };
    }),
  };
};

export interface GuidesSourceOptions {
  /** A directory of Markdown guides; subdirectories become nested slugs. */
  readonly directory: string;
  readonly folder?: string;
  readonly title: string;
}

const markdownFiles = (directory: string): string[] =>
  readdirSync(directory)
    .sort()
    .flatMap(name => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return markdownFiles(path);
      return name.endsWith('.md') ? [path] : [];
    });

const frontmatterOf = (
  file: string,
  input: string,
): { title: string; description?: string; order: number; content: string } => {
  const { data, content } = frontmatter(input);
  // fumadocs answers `{}` for a file with no frontmatter at all.
  const fields = data as Record<string, unknown>;
  const { title, description, order } = fields;
  if (typeof title !== 'string' || title.trim() === '') {
    throw new DocsContentError(file, 'needs a `title` in its frontmatter');
  }
  return {
    title,
    ...(typeof description === 'string' ? { description } : {}),
    order: typeof order === 'number' ? order : Number.MAX_SAFE_INTEGER,
    content,
  };
};

/**
 * Markdown guides, one page per file, titled by their frontmatter and ordered
 * by its `order` (then by file name). A guide cites what it describes with the
 * engine's directives, checked when the site is created.
 */
export const guidesSource = ({
  directory,
  folder = 'guides',
  title,
}: GuidesSourceOptions): DocsSource => ({
  folder,
  title,
  pages: markdownFiles(directory)
    .map(file => {
      const read = frontmatterOf(file, readFileSync(file, 'utf8'));
      const path = relative(directory, file).split(sep);
      const last = (path.pop() as string).replace(/\.md$/, '');
      return {
        order: read.order,
        page: {
          slugs: [folder, ...path, ...(last === 'index' ? [] : [last])],
          title: read.title,
          ...(read.description === undefined
            ? {}
            : { description: read.description }),
          markdown: read.content,
          file,
        },
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ page }) => page),
});

/** A page a host derives, addressed relative to its folder. */
export type ReferencePage = Omit<DocsPageInput, 'slugs' | 'record'> & {
  readonly path: readonly string[];
};

/**
 * Pages a host derives from its own metadata — entities, use cases, endpoints.
 * The engine knows no host's entities; the host writes the function and hands
 * the engine its pages (entifix ADR 0031 §3).
 */
export const referenceSource = (
  folder: string,
  title: string,
  derive: () => readonly ReferencePage[],
): DocsSource => ({
  folder,
  title,
  pages: derive().map(({ path, ...page }) => ({
    ...page,
    slugs: [folder, ...path],
  })),
});
