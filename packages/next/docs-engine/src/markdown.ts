import {
  rehypeCode,
  remarkGfm,
  remarkHeading,
} from 'fumadocs-core/mdx-plugins';
import type { TOCItemType } from 'fumadocs-core/toc';
import type { Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import remarkDirective from 'remark-directive';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { VFile } from 'vfile';

import { remarkDocsDirectives } from './directives.js';
import type { ReferenceRegistry } from './references.js';

/**
 * Shiki's high-contrast pair. entifix has no syntax palette of its own, and
 * the default GitHub themes measured 3.48:1 on white (spike, ADR 0031).
 */
export const CODE_THEMES = {
  light: 'github-light-high-contrast',
  dark: 'github-dark-high-contrast',
} as const;

const processor = (file: string, references: ReferenceRegistry) =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkDocsDirectives, { file, references })
    .use(remarkHeading)
    .use(remarkRehype)
    .use(rehypeCode, { themes: CODE_THEMES, lazy: true });

/**
 * Parses and checks a page without rendering it: an unknown directive or id
 * throws here. The site runs it over every page when it is created, so one bad
 * citation fails the build however many pages are never visited.
 */
export const checkMarkdown = (
  markdown: string,
  file: string,
  references: ReferenceRegistry,
): void => {
  const parser = unified()
    .use(remarkParse)
    .use(remarkDirective)
    .use(remarkDocsDirectives, { file, references });
  parser.runSync(parser.parse(markdown) as MdastRoot);
};

export interface RenderedMarkdown {
  readonly tree: HastRoot;
  readonly toc: readonly TOCItemType[];
}

/** A page's body as HTML's tree, highlighted, with its table of contents. */
export const renderMarkdown = async (
  markdown: string,
  file: string,
  references: ReferenceRegistry,
): Promise<RenderedMarkdown> => {
  const pipeline = processor(file, references);
  const vfile = new VFile({ path: file, value: markdown });
  const tree = (await pipeline.run(pipeline.parse(vfile), vfile)) as HastRoot;
  // remark-heading always writes the table of contents (`generateToc` is on).
  return { tree, toc: vfile.data.toc as readonly TOCItemType[] };
};
