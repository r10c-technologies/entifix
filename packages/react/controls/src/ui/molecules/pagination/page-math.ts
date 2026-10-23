/**
 * How many pages a listing spans. An empty listing is still one page: "page 1
 * of 0" reads as broken.
 */
export function pageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

/** A page number to link to, or a gap standing for the pages between two. */
export type PageWindowEntry =
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'gap'; readonly after: number };

/**
 * The page numbers worth linking from `current`: the first, the last, and
 * `radius` either side of the current one, with a gap wherever pages are
 * skipped.
 *
 * A gap replaces two or more pages, never one: `1 … 3` hides a single page
 * behind a glyph that is as wide as its number, so the page is shown instead.
 */
export function pageWindow(
  current: number,
  total: number,
  radius = 1,
): PageWindowEntry[] {
  const wanted = new Set<number>([1, total]);
  for (let page = current - radius; page <= current + radius; page += 1) {
    if (page >= 1 && page <= total) wanted.add(page);
  }
  const pages = [...wanted].sort((a, b) => a - b);

  const entries: PageWindowEntry[] = [];
  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined && page - previous === 2) {
      entries.push({ kind: 'page', page: previous + 1 });
    } else if (previous !== undefined && page - previous > 2) {
      entries.push({ kind: 'gap', after: previous });
    }
    entries.push({ kind: 'page', page });
  });
  return entries;
}
