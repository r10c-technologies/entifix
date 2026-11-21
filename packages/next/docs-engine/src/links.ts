const RECORD_FILE = /^(\d{4})-.*\.md$/;

export interface LinkTargets {
  /** Where a link to another record of the same collection goes: its page. */
  readonly record: (id: string, anchor: string | undefined) => string;
  /**
   * Where any other relative link goes — a file of the repository the record
   * was written in, usually on GitHub. `path` is relative to the collection.
   */
  readonly file: (path: string, anchor: string | undefined) => string;
}

/**
 * A record's relative links, pointed at the site: a sibling record to its
 * page, anything else to the file it names. An absolute URL, a root-relative
 * path and an in-page anchor are left as they are.
 *
 * Graduated from myself-app's `sync-adrs.mjs` (entifix ADR 0031 §5); the page
 * scheme is the host's, so both targets are functions it passes.
 */
export const rewriteLinks = (markdown: string, targets: LinkTargets): string =>
  markdown.replace(/\]\(([^)\s]+)\)/g, (whole, url: string) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return whole;
    const [path = '', anchor] = url.split('#');
    const record = RECORD_FILE.exec(path);
    if (record) return `](${targets.record(record[1] as string, anchor)})`;
    return `](${targets.file(path, anchor)})`;
  });
