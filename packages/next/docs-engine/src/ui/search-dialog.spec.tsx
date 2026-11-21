import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { FrameworkProvider } from 'fumadocs-core/framework';

import PagefindSearchDialog from './search-dialog.js';

const push = vi.fn();
const router = { push, refresh: vi.fn() };

const search = vi.hoisted(() => vi.fn());
vi.mock('./pagefind.js', async original => ({
  ...(await original<typeof import('./pagefind.js')>()),
  loadPagefind: (indexUrl: string) => async () => ({
    search: async (query: string) => {
      search(indexUrl, query);
      return {
        results: [
          {
            id: '1',
            data: async () => ({
              url: '/r/1/',
              meta: { title: 'One' },
              excerpt: 'x',
            }),
          },
        ],
      };
    },
  }),
}));

describe('PagefindSearchDialog', () => {
  it('names its Close button after the word it shows, and searches the index', async () => {
    const onOpenChange = vi.fn();
    render(
      <FrameworkProvider
        usePathname={() => '/'}
        useParams={() => ({})}
        useRouter={() => router}
      >
        <PagefindSearchDialog
          open
          onOpenChange={onOpenChange}
          indexUrl="/x/pagefind/"
        />
      </FrameworkProvider>,
    );
    const close = screen.getByRole('button', { name: 'Esc, close search' });
    expect(close).toHaveTextContent(/^Esc$/);

    await userEvent.type(screen.getByRole('combobox'), 'one');
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith('/x/pagefind/', 'one'),
    );
    expect(
      await screen.findByRole('option', { name: /One/ }),
    ).toBeInTheDocument();

    await userEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
