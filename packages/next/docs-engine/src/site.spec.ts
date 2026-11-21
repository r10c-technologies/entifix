import { referenceKind } from './references.js';
import { createDocsSite } from './site.js';
import type { DocsSource } from './sources.js';

const guides: DocsSource = {
  folder: 'guides',
  title: 'Guides',
  pages: [
    {
      slugs: ['guides'],
      title: 'Home',
      markdown: 'Hi :record[0001].',
      file: 'index.md',
    },
    {
      slugs: ['guides', 'start'],
      title: 'Start',
      description: 'Begin here',
      markdown: '## Install\n\n```ts\nconst a = 1;\n```\n\n### Then\n\nGo.',
      file: 'start.md',
    },
  ],
};
const records: DocsSource = {
  folder: 'records',
  title: 'Records',
  pages: [
    {
      slugs: ['records', '0001'],
      title: '1. One',
      markdown: 'Body',
      file: '0001.md',
    },
  ],
};
const references = { record: referenceKind(['0001'], id => `/records/${id}/`) };

describe('createDocsSite', () => {
  const site = createDocsSite({
    baseUrl: '/',
    sources: [guides, records],
    references,
  });
  const pageOf = (slugs: string[]) => {
    const page = site.page(slugs);
    if (page === undefined) throw new Error(`no page at ${slugs.join('/')}`);
    return page.data;
  };

  it('builds one tree, folders in the given order', () => {
    expect(site.pageTree.children.map(node => node.name)).toEqual([
      'Guides',
      'Records',
    ]);
    expect(site.params().map(param => param.slug)).toEqual(
      expect.arrayContaining([
        ['guides'],
        ['guides', 'start'],
        ['records', '0001'],
      ]),
    );
  });

  it('answers a page by its slugs, and nothing for an address it does not serve', () => {
    expect(site.page(['guides', 'start'])?.data.title).toBe('Start');
    expect(site.page(['guides', 'start'])?.data.description).toBe('Begin here');
    expect(site.page(['nowhere'])).toBeUndefined();
    expect(site.page(undefined)).toBeUndefined();
  });

  it('renders a body with its citations, its highlighted code and its contents', async () => {
    const rendered = await site.render(pageOf(['guides']));
    expect(JSON.stringify(rendered.tree)).toContain('/records/0001/');
    const start = await site.render(pageOf(['guides', 'start']));
    expect(start.toc.map(item => item.url)).toEqual(['#install', '#then']);
    expect(JSON.stringify(start.tree)).toContain('shiki');
  });

  it('refuses two pages at one address', () => {
    expect(() =>
      createDocsSite({ baseUrl: '/', sources: [records, records] }),
    ).toThrow('0001.md: is served at /records/0001, which 0001.md already is');
  });

  it('refuses a page citing what no registry holds, before anything renders', () => {
    expect(() => createDocsSite({ baseUrl: '/', sources: [guides] })).toThrow(
      'index.md:1: holds an unknown directive ":record"',
    );
  });
});
