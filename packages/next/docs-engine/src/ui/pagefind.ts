import type { SortedResult } from 'fumadocs-core/search';

/** What Pagefind's `search()` answers, as far as the engine reads it. */
interface PagefindSubResult {
  readonly title: string;
  readonly url: string;
  readonly excerpt: string;
}
interface PagefindData {
  readonly url: string;
  readonly meta: { readonly title?: string };
  readonly excerpt: string;
  readonly sub_results?: readonly PagefindSubResult[];
}
export interface Pagefind {
  search: (query: string) => Promise<{
    results: readonly {
      readonly id: string;
      data: () => Promise<PagefindData>;
    }[];
  }>;
}

/** Pagefind's excerpt is HTML with `<mark>`; fumadocs highlights by itself. */
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** At most this many pages; each brings its best sections along. */
const PAGES = 8;
const SECTIONS = 3;

/**
 * Pagefind's results as fumadocs' sorted results: a page, then the sections of
 * it that matched. A section whose URL is the page's own is the page's body and
 * is shown as its text rather than as a second heading.
 */
export const toSortedResults = async (
  pagefind: Pagefind,
  query: string,
): Promise<SortedResult[]> => {
  if (query.trim() === '') return [];
  const { results } = await pagefind.search(query);
  const pages = await Promise.all(
    results.slice(0, PAGES).map(result => result.data()),
  );
  return pages.flatMap((page): SortedResult[] => [
    {
      id: page.url,
      url: page.url,
      type: 'page',
      content: page.meta.title ?? page.url,
    },
    ...(page.sub_results ?? [])
      .filter(sub => sub.url !== page.url)
      .slice(0, SECTIONS)
      .map((sub): SortedResult => ({
        id: sub.url,
        url: sub.url,
        type: 'heading',
        content: sub.title,
      })),
    {
      id: `${page.url}#excerpt`,
      url: page.url,
      type: 'text',
      content: plain(page.excerpt),
    },
  ]);
};

/**
 * Loads the index `pagefind --site` wrote beside the export, once. It is a
 * file of the exported site, not a module of the bundle, so the import is
 * opaque to the bundler.
 */
export const loadPagefind = (indexUrl: string): (() => Promise<Pagefind>) => {
  let loading: Promise<Pagefind> | undefined;
  return () => {
    loading ??= import(
      /* webpackIgnore: true */ /* @vite-ignore */ `${indexUrl}pagefind.js`
    ) as Promise<Pagefind>;
    return loading;
  };
};
