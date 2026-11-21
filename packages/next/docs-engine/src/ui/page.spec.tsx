import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createDocsSite } from '../site.js';
import { docsMetadata, DocsPage } from './page.js';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('fumadocs-ui/page', () => {
  const pass =
    (Tag: 'section' | 'h1' | 'p' | 'div') =>
    ({ children, ...props }: { children?: ReactNode }) => (
      <Tag {...props}>{children}</Tag>
    );
  return {
    DocsPage: pass('section'),
    DocsTitle: pass('h1'),
    DocsDescription: pass('p'),
    DocsBody: pass('div'),
  };
});
vi.mock('fumadocs-ui/mdx', () => ({ default: {} }));

const site = createDocsSite({
  baseUrl: '/',
  sources: [
    {
      folder: 'g',
      title: 'G',
      pages: [
        {
          slugs: ['g'],
          title: 'Home',
          description: 'The start',
          markdown:
            '## Part\n\n#### Deeper\n\n##### Deepest\n\n###### Last\n\n### Mid\n\nText.',
          file: 'g.md',
        },
        { slugs: ['g', 'b'], title: 'Bare', markdown: 'B.', file: 'b.md' },
      ],
    },
  ],
});

describe('DocsPage', () => {
  it('renders the title, the description and an indexed body with plain headings', async () => {
    render(await DocsPage({ site, slugs: ['g'] }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Home');
    expect(screen.getByText('The start')).toBeInTheDocument();
    const part = screen.getByRole('heading', { level: 2, name: 'Part' });
    expect(part).toHaveAttribute('id', 'part');
    expect(part.querySelector('button')).toBeNull();
    expect(part.closest('[data-pagefind-body]')).not.toBeNull();
    for (const level of [3, 4, 5, 6]) {
      expect(screen.getByRole('heading', { level })).toBeInTheDocument();
    }
  });

  it('renders no description where a page has none, and takes the host’s elements', async () => {
    render(
      await DocsPage({
        site,
        slugs: ['g', 'b'],
        components: { p: (() => <p>{'custom'}</p>) as never },
      }),
    );
    expect(screen.getByText('custom')).toBeInTheDocument();
  });

  it('is not found where nothing is served', async () => {
    await expect(DocsPage({ site, slugs: ['x'] })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});

describe('docsMetadata', () => {
  it('answers the title and, when there is one, the description', () => {
    expect(docsMetadata(site, ['g'])).toEqual({
      title: 'Home',
      description: 'The start',
    });
    expect(docsMetadata(site, ['g', 'b'])).toEqual({ title: 'Bare' });
    expect(() => docsMetadata(site, undefined)).toThrow('NEXT_NOT_FOUND');
  });
});
