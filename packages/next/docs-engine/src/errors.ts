/**
 * A source the engine cannot turn into a page: an unknown directive, an id the
 * host's registry does not hold, a record collection with problems. It names
 * the file and, when it has one, the line — so a typo is caught where it was
 * made, and `next build` stops on it rather than exporting a page with the
 * mistake written into it.
 */
export class DocsContentError extends Error {
  override readonly name = 'DocsContentError';

  constructor(
    readonly file: string,
    readonly detail: string,
    readonly line?: number,
  ) {
    super(`${file}${line === undefined ? '' : `:${line}`}: ${detail}`);
  }
}
