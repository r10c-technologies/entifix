import { loader, type PageData, type VirtualFile } from 'fumadocs-core/source';

import { DocsContentError } from './errors.js';
import { checkMarkdown, renderMarkdown } from './markdown.js';
import type { ReferenceRegistry } from './references.js';
import type { DocsPageInput, DocsSource } from './sources.js';

export interface DocsSiteOptions {
  /** Where the pages are served, below the app's `basePath`: `/docs`. */
  readonly baseUrl: string;
  /** The sections, in the order the sidebar shows them. */
  readonly sources: readonly DocsSource[];
  /** What each citation directive resolves against. */
  readonly references?: ReferenceRegistry;
}

/** What a page carries into the loader, and what a route reads back. */
export interface DocsPageData {
  readonly title: string;
  readonly description?: string;
  readonly input: DocsPageInput;
}

const keyOf = (slugs: readonly string[]) => slugs.join('/');

/** A page's file, as fumadocs reads the tree: `records/0031.md`, `guides/index.md`. */
const pathOf = (slugs: readonly string[]) =>
  slugs.length === 1 ? `${slugs[0]}/index.md` : `${keyOf(slugs)}.md`;

/** The direct children of a folder, in the source's order. */
const childrenOf = (source: DocsSource): string[] => [
  ...new Set(
    source.pages.map(page =>
      page.slugs.length === 1 ? 'index' : (page.slugs[1] as string),
    ),
  ),
];

const virtualFiles = (sources: readonly DocsSource[]): VirtualFile[] => [
  {
    type: 'meta',
    path: 'meta.json',
    data: { pages: sources.map(source => source.folder) },
  },
  ...sources.flatMap((source): VirtualFile[] => [
    {
      type: 'meta',
      path: `${source.folder}/meta.json`,
      data: { title: source.title, pages: [...childrenOf(source), '...'] },
    },
    ...source.pages.map((page): VirtualFile => ({
      type: 'page',
      path: pathOf(page.slugs),
      slugs: [...page.slugs],
      // fumadocs types a page's data as its own frontmatter shape; the
      // engine's carries the input beside it, read back by `page()`.
      data: {
        title: page.title,
        ...(page.description === undefined
          ? {}
          : { description: page.description }),
        input: page,
      } satisfies DocsPageData as PageData,
    })),
  ]),
];

/**
 * One site from its sources: a `fumadocs-core` page tree, the pages a route
 * renders, and the parameters a static export enumerates.
 *
 * Every page is checked when the site is created — a duplicate address, an
 * unknown directive, an id the registry does not hold — so `next build` stops
 * on the first mistake with its file and line, whichever pages a reader would
 * visit.
 */
export const createDocsSite = ({
  baseUrl,
  sources,
  references = {},
}: DocsSiteOptions) => {
  const seen = new Map<string, string>();
  for (const page of sources.flatMap(source => source.pages)) {
    const key = keyOf(page.slugs);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      throw new DocsContentError(
        page.file,
        `is served at /${key}, which ${earlier} already is`,
      );
    }
    seen.set(key, page.file);
    checkMarkdown(page.markdown, page.file, references);
  }

  const source = loader({
    baseUrl,
    source: { files: virtualFiles(sources) },
  });

  return {
    source,
    /** The page tree the layout's sidebar renders. */
    pageTree: source.pageTree,
    /** A page by its slugs, or `undefined` for an address nothing serves. */
    page: (slugs: readonly string[] | undefined) => {
      const found = source.getPage([...(slugs ?? [])]);
      return found === undefined
        ? undefined
        : { url: found.url, data: found.data as unknown as DocsPageData };
    },
    /** A page's body and table of contents. */
    render: (data: DocsPageData) =>
      renderMarkdown(data.input.markdown, data.input.file, references),
    /** Every address, for `generateStaticParams`. */
    params: () => source.generateParams(),
  };
};

export type DocsSite = ReturnType<typeof createDocsSite>;
