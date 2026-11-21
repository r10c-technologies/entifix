import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createDocsSite } from '../site.js';
import { DocsLayout } from './layout.js';

const captured = vi.hoisted(() => ({ props: undefined as unknown }));
vi.mock('fumadocs-ui/layouts/docs', () => ({
  DocsLayout: (props: {
    children: ReactNode;
    sidebar: { footer: ReactNode };
  }) => {
    captured.props = props;
    return (
      <div>
        {props.sidebar.footer}
        {props.children}
      </div>
    );
  },
}));
vi.mock('@entifix/react-controls', async original => ({
  ...(await original<typeof import('@entifix/react-controls')>()),
  ThemeSwitcher: () => <p>{'switcher'}</p>,
}));

describe('DocsLayout', () => {
  it('puts a skip link first, and entifix theme switcher in place of fumadocs’', () => {
    const site = createDocsSite({
      baseUrl: '/',
      sources: [
        {
          folder: 'g',
          title: 'G',
          pages: [{ slugs: ['g'], title: 'G', markdown: 'x', file: 'g.md' }],
        },
      ],
    });
    render(
      <DocsLayout site={site} title="Site">
        <span>{'body'}</span>
      </DocsLayout>,
    );
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#nd-page');
    expect(screen.getByText('switcher')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(captured.props).toMatchObject({
      tree: site.pageTree,
      nav: { title: 'Site' },
      themeSwitch: { enabled: false },
    });
  });
});
