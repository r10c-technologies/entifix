import { loadPagefind, type Pagefind, toSortedResults } from './pagefind.js';

const pagefind = (pages: unknown[]): Pagefind => ({
  search: async () => ({
    results: pages.map((page, index) => ({
      id: String(index),
      data: async () => page as never,
    })),
  }),
});

describe('toSortedResults', () => {
  it('answers nothing for a blank query, without searching', async () => {
    const search = vi.fn();
    expect(await toSortedResults({ search }, '  ')).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('lists a page, its matching sections, then its excerpt as plain text', async () => {
    const results = await toSortedResults(
      pagefind([
        {
          url: '/r/1/',
          meta: { title: 'One' },
          excerpt:
            'an <mark>outbox</mark> &amp; &lt;inbox&gt; &quot;x&quot; &#39;y&#39;',
          sub_results: [
            { title: 'One', url: '/r/1/', excerpt: '' },
            { title: 'Why', url: '/r/1/#why', excerpt: '' },
          ],
        },
        { url: '/r/2/', meta: {}, excerpt: 'two' },
      ]),
      'outbox',
    );
    expect(results).toEqual([
      { id: '/r/1/', url: '/r/1/', type: 'page', content: 'One' },
      { id: '/r/1/#why', url: '/r/1/#why', type: 'heading', content: 'Why' },
      {
        id: '/r/1/#excerpt',
        url: '/r/1/',
        type: 'text',
        content: `an outbox & <inbox> "x" 'y'`,
      },
      { id: '/r/2/', url: '/r/2/', type: 'page', content: '/r/2/' },
      { id: '/r/2/#excerpt', url: '/r/2/', type: 'text', content: 'two' },
    ]);
  });
});

describe('loadPagefind', () => {
  it('imports the index once, however often it is asked for', async () => {
    const module = 'data:text/javascript,export const search = () => 7;//';
    const load = loadPagefind(module);
    const first = await load();
    expect(await load()).toBe(first);
    expect((first.search as unknown as () => number)()).toBe(7);
  });
});
