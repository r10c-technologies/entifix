import { join } from 'node:path';

import { guidesSource, recordsSource, referenceSource } from './sources.js';
import { directoryOf, guide, record } from './spec-support.js';

const links = {
  record: (id: string) => `/records/${id}/`,
  file: (path: string) => `https://x/${path}`,
};

describe('recordsSource', () => {
  it('reads each record into a page, its links pointed at the site', () => {
    const directory = directoryOf({
      '0001-one.md': record(1, 'See [two](0002-two.md).\n'),
      '0002-two.md': record(2),
    });
    const source = recordsSource({
      directory,
      areas: ['platform'],
      title: 'Records',
      links,
    });
    expect(source.folder).toBe('records');
    expect(source.pages.map(page => [page.slugs, page.title])).toEqual([
      [['records', '0001'], '1. Title 1'],
      [['records', '0002'], '2. Title 2'],
    ]);
    expect(source.pages[0]?.markdown).toContain('See [two](/records/0002/).');
    expect(source.pages[0]?.markdown).not.toContain('# 1.');
    expect(source.pages[0]?.record?.id).toBe('0001');
    expect(source.pages[0]?.file).toBe(join(directory, '0001-one.md'));
  });

  it('refuses a collection the reader finds problems in', () => {
    const directory = directoryOf({ '0001-one.md': record(1, 'x', 'nowhere') });
    expect(() =>
      recordsSource({
        directory,
        areas: ['platform'],
        folder: 'adr',
        title: 'Records',
        links,
      }),
    ).toThrow(directory);
  });
});

describe('guidesSource', () => {
  it('reads guides in frontmatter order, nested folders as slugs', () => {
    const directory = directoryOf({
      'b.md': guide('B', 'Bee.', 'order: 2\n'),
      'a.md': guide('A', 'Ay.', 'description: First\norder: 1\n'),
      'index.md': guide('Home', 'Hi.', 'order: 0\n'),
      'deep/c.md': guide('C', 'Sea.'),
      'deep/index.md': guide('Deep', 'Down.', 'order: 9\n'),
      'image.png': 'not a guide',
    });
    const source = guidesSource({ directory, title: 'Guides' });
    expect(source.pages.map(page => page.slugs.join('/'))).toEqual([
      'guides',
      'guides/a',
      'guides/b',
      'guides/deep',
      'guides/deep/c',
    ]);
    expect(source.pages[1]).toMatchObject({
      title: 'A',
      description: 'First',
      markdown: expect.stringContaining('Ay.'),
    });
    expect(source.pages[0]).not.toHaveProperty('description');
  });

  it('refuses a guide with no title', () => {
    const directory = directoryOf({ 'x.md': '---\norder: 1\n---\nBody' });
    expect(() => guidesSource({ directory, folder: 'g', title: 'G' })).toThrow(
      'needs a `title` in its frontmatter',
    );
    const bare = directoryOf({ 'y.md': 'No frontmatter at all.' });
    expect(() => guidesSource({ directory: bare, title: 'G' })).toThrow(
      'needs a `title`',
    );
  });
});

describe('referenceSource', () => {
  it('places the pages a host derives under its folder', () => {
    const source = referenceSource('api', 'API', () => [
      { path: ['order'], title: 'Order', markdown: '# x', file: 'gen:order' },
    ]);
    expect(source).toEqual({
      folder: 'api',
      title: 'API',
      pages: [
        {
          slugs: ['api', 'order'],
          title: 'Order',
          markdown: '# x',
          file: 'gen:order',
        },
      ],
    });
  });
});
