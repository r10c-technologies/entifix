import { act, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { Suspense } from 'react';

import { DocsRoot } from './root.js';

const captured = vi.hoisted(() => ({ props: undefined as unknown }));

vi.mock('fumadocs-ui/provider/next', () => ({
  RootProvider: (props: { children: ReactNode }) => {
    captured.props = props;
    return props.children;
  },
}));
vi.mock('./search-dialog.js', () => ({
  default: ({ indexUrl }: { indexUrl: string }) => (
    <p>{`dialog ${indexUrl}`}</p>
  ),
}));

const themes = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'midnight', label: 'Midnight' },
];

interface Captured {
  theme: { enabled: boolean };
  search: {
    SearchDialog: ComponentType<{ indexUrl: string }>;
    options: { indexUrl: string };
  };
  i18n: { locale: string; translations: Record<string, string> };
}

describe('DocsRoot', () => {
  afterEach(() => {
    document.cookie = 'entifix-theme=; path=/; max-age=0';
  });

  it('turns fumadocs theming off, searches Pagefind and speaks the catalog', async () => {
    render(
      <DocsRoot
        locale="en"
        themes={themes}
        darkPalettes={['midnight']}
        searchIndexUrl="/x/pagefind/"
      >
        <span>{'page'}</span>
      </DocsRoot>,
    );
    expect(screen.getByText('page')).toBeInTheDocument();
    const props = captured.props as Captured;
    expect(props.theme).toEqual({ enabled: false });
    expect(props.search.options).toEqual({ indexUrl: '/x/pagefind/' });
    expect(props.i18n.locale).toBe('en');
    expect(
      props.i18n.translations['Close Search(search dialog)(aria-label)'],
    ).toBe('Esc, close search');
    expect(
      Object.values(props.i18n.translations).every(
        value => !value.startsWith('docs.'),
      ),
    ).toBe(true);

    const { SearchDialog } = props.search;
    render(
      <Suspense fallback={null}>
        <SearchDialog indexUrl="/x/pagefind/" />
      </Suspense>,
    );
    expect(await screen.findByText('dialog /x/pagefind/')).toBeInTheDocument();
  });

  it('follows the palette with the scheme', async () => {
    document.cookie = 'entifix-theme=midnight; path=/';
    await act(async () => {
      render(
        <DocsRoot
          locale="en"
          themes={themes}
          defaultTheme="aurora"
          darkPalettes={['midnight']}
          searchIndexUrl="/pagefind/"
        >
          {null}
        </DocsRoot>,
      );
    });
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-scheme')).toBe('dark'),
    );
  });
});
