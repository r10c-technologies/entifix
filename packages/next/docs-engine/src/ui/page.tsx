import defaultMdxComponents from 'fumadocs-ui/mdx';
import {
  DocsBody,
  DocsDescription,
  DocsPage as FumadocsPage,
  DocsTitle,
} from 'fumadocs-ui/page';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { notFound } from 'next/navigation';
import type { ComponentProps, ComponentType } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

import type { DocsSite } from '../site.js';

export interface DocsPageProps {
  readonly site: DocsSite;
  /** The route's catch-all segment. */
  readonly slugs: readonly string[] | undefined;
  /** Elements to render differently, keyed by tag name. */
  readonly components?: Readonly<Record<string, ComponentType<never>>>;
}

type HeadingTag = 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/**
 * A heading with no copy-link button inside it. fumadocs' own puts a button in
 * every heading, and Pagefind indexed its label as part of the heading's text —
 * every search result read "…Copy the link to this section". The table of
 * contents already links each heading.
 */
const plainHeading = (Tag: HeadingTag) =>
  function Heading(props: ComponentProps<HeadingTag>) {
    return <Tag {...props} className="scroll-m-28" />;
  };

const HEADINGS = {
  h2: plainHeading('h2'),
  h3: plainHeading('h3'),
  h4: plainHeading('h4'),
  h5: plainHeading('h5'),
  h6: plainHeading('h6'),
};

/**
 * One page of the site: its title, its description and its body, rendered on
 * the server at build time. The article carries `data-pagefind-body`, so the
 * search index holds what a page says and not its chrome (entifix #276).
 */
export async function DocsPage({ site, slugs, components }: DocsPageProps) {
  const page = site.page(slugs);
  if (page === undefined) notFound();
  const { tree, toc } = await site.render(page.data);
  const body = toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components: {
      ...defaultMdxComponents,
      ...HEADINGS,
      ...components,
    } as never,
  });
  return (
    <FumadocsPage toc={[...toc]}>
      <div data-pagefind-body="">
        <DocsTitle data-pagefind-meta="title">{page.data.title}</DocsTitle>
        {page.data.description === undefined ? null : (
          <DocsDescription>{page.data.description}</DocsDescription>
        )}
        <DocsBody>{body}</DocsBody>
      </div>
    </FumadocsPage>
  );
}

/** A page's `<title>` and description, for `generateMetadata`. */
export const docsMetadata = (
  site: DocsSite,
  slugs: readonly string[] | undefined,
) => {
  const page = site.page(slugs);
  if (page === undefined) notFound();
  return {
    title: page.data.title,
    ...(page.data.description === undefined
      ? {}
      : { description: page.data.description }),
  };
};
