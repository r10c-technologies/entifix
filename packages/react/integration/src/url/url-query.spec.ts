import { run } from '@entifix/testing-unit';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { describe, expect, it } from 'vitest';

import { Note, NOTES, titleIn } from './spec-support/notes.js';
import { anyOf, containing, defineUrlQuery, inAnyYear } from './url-query.js';

const query = defineUrlQuery({
  params: {
    tag: { allowed: ['web', 'data'], condition: anyOf('tags') },
    year: { condition: inAnyYear('writtenAt') },
    q: {
      single: true,
      condition: containing(titleIn),
    },
  },
  sorting: [{ 0: { property: 'writtenAt', type: 'desc' } }],
});

const ids = async (search: string, locale: 'en' | 'es' = 'en') => {
  const page = await run(
    makeInMemoryEntityRepository(NOTES).load<Note>({
      ...query.request<Note>(query.parse(search), locale),
      pageSize: 100,
    }),
  );
  return page.items.map(note => note.id);
};

describe('parse', () => {
  it('reads every declared parameter, in the order given', () => {
    expect(query.parse('?tag=data&tag=web&year=2026&q=que')).toEqual({
      tag: ['data', 'web'],
      year: ['2026'],
      q: ['que'],
    });
  });

  it('drops what is not allowed, blank or repeated, and undeclared names', () => {
    expect(query.parse('?tag=gone&tag=web&tag=web&year=%20&other=1')).toEqual({
      tag: ['web'],
      year: [],
      q: [],
    });
  });

  it('keeps one value of a single parameter, as written', () => {
    expect(query.parse('?q=first%20&q=second').q).toEqual(['first ']);
  });
});

describe('serialize', () => {
  it('writes the parameters in declared order', () => {
    expect(
      query.serialize({ q: ['x y'], tag: ['web', 'data'], year: [] }),
    ).toBe('?tag=web&tag=data&q=x+y');
  });

  it('writes nothing for an empty state', () => {
    expect(query.serialize(query.empty)).toBe('');
  });

  it('round-trips through parse', () => {
    const state = query.parse('?tag=web&year=2025&year=2026&q=sites');
    expect(query.parse(query.serialize(state))).toEqual(state);
  });
});

describe('isEmpty', () => {
  it('is true only when no parameter has a value', () => {
    expect(query.isEmpty(query.empty)).toBe(true);
    expect(query.isEmpty(query.parse('?year=2026'))).toBe(false);
  });
});

describe('request', () => {
  it('asks for everything, sorted, with no parameter set', async () => {
    expect(query.request(query.empty, 'en')).toEqual({
      sorting: [{ 0: { property: 'writtenAt', type: 'desc' } }],
    });
    expect(await ids('')).toEqual(['effects', 'queries', 'static']);
  });

  it('matches any tag, as a collection holds any of them', async () => {
    expect(await ids('?tag=web')).toEqual(['queries', 'static']);
  });

  it('matches any year, both ends included', async () => {
    expect(await ids('?year=2025')).toEqual(['static']);
    expect(await ids('?year=2025&year=2026')).toHaveLength(3);
  });

  it('searches for the text without its surrounding spaces', async () => {
    expect(await ids('?q=%20queries%20')).toEqual(['queries']);
  });

  it('searches the text of the locale asked for', async () => {
    expect(await ids('?q=consultas', 'es')).toEqual(['queries']);
    expect(await ids('?q=consultas', 'en')).toEqual([]);
  });

  it('combines every parameter with and', async () => {
    expect(await ids('?tag=data&year=2026&q=eff')).toEqual(['effects']);
  });

  it('leaves out sorting when none is declared', () => {
    const plain = defineUrlQuery({
      params: { tag: { condition: anyOf('tags') } },
    });
    expect(plain.request(plain.parse('?tag=web'), undefined)).toEqual({
      filtering: [{ property: 'tags', operator: 'in', values: ['web'] }],
    });
  });
});

describe('a sort parameter', () => {
  const sortable = defineUrlQuery({
    params: {
      tag: { condition: anyOf('tags') },
      sort: {
        sorting: {
          oldest: [{ 0: { property: 'writtenAt', type: 'asc' } }],
          newest: [{ 0: { property: 'writtenAt', type: 'desc' } }],
        },
      },
    },
    sorting: [{ 0: { property: 'writtenAt', type: 'desc' } }],
  });

  const sortedIds = async (search: string) => {
    const page = await run(
      makeInMemoryEntityRepository(NOTES).load<Note>({
        ...sortable.request<Note>(sortable.parse(search), undefined),
        pageSize: 100,
      }),
    );
    return page.items.map(note => note.id);
  };

  it('keeps one sorting it names, and drops any other', () => {
    expect(sortable.parse('?sort=oldest&sort=newest')).toEqual({
      tag: [],
      sort: ['oldest'],
    });
    expect(sortable.parse('?sort=title')).toEqual({ tag: [], sort: [] });
  });

  it('orders the answer as chosen, or as declared when nothing is', async () => {
    expect(await sortedIds('?sort=oldest')).toEqual([
      'static',
      'queries',
      'effects',
    ]);
    expect(await sortedIds('')).toEqual(['effects', 'queries', 'static']);
    expect(await sortedIds('?tag=data&sort=oldest')).toEqual([
      'queries',
      'effects',
    ]);
  });

  it('is no filter, and outlives clearing the filters', () => {
    const state = sortable.parse('?tag=web&sort=oldest');
    expect(sortable.isFiltering(state)).toBe(true);
    const cleared = sortable.withoutFilters(state);
    expect(cleared).toEqual({ tag: [], sort: ['oldest'] });
    expect(sortable.isFiltering(cleared)).toBe(false);
    expect(sortable.isEmpty(cleared)).toBe(false);
  });
});

describe('a selection parameter', () => {
  const selecting = defineUrlQuery({
    params: {
      tag: { condition: anyOf('tags') },
      note: { select: true, allowed: ['static', 'queries'] },
      any: { select: true },
    },
  });

  it('keeps one value it allows, and drops any other', () => {
    expect(selecting.parse('?note=queries&note=static&any=x&any=y')).toEqual({
      tag: [],
      note: ['queries'],
      any: ['x'],
    });
    expect(selecting.parse('?note=effects').note).toEqual([]);
  });

  it('asks the load nothing, and outlives clearing the filters', () => {
    const state = selecting.parse('?tag=web&note=static');
    expect(selecting.isAsking(state)).toBe(true);
    const cleared = selecting.withoutFilters(state);
    expect(cleared).toEqual({ tag: [], note: ['static'], any: [] });
    expect(selecting.isFiltering(cleared)).toBe(false);
    expect(selecting.isAsking(cleared)).toBe(false);
    expect(selecting.isEmpty(cleared)).toBe(false);
    expect(selecting.request(state, undefined)).toEqual({
      filtering: [{ property: 'tags', operator: 'in', values: ['web'] }],
    });
  });
});

describe('a page parameter', () => {
  const paged = defineUrlQuery({
    params: {
      tag: { condition: anyOf('tags') },
      sort: {
        sorting: { newest: [{ 0: { property: 'writtenAt', type: 'desc' } }] },
      },
      note: { select: true },
      page: { pageSize: 2 },
    },
  });

  it('keeps one positive integer, and writes page 1 as no value', () => {
    expect(paged.parse('?page=3&page=4').page).toEqual(['3']);
    expect(paged.parse('?page=1').page).toEqual([]);
    expect(paged.parse('?page=0').page).toEqual([]);
    expect(paged.parse('?page=-2').page).toEqual([]);
    expect(paged.parse('?page=02').page).toEqual([]);
    expect(paged.parse('?page=two').page).toEqual([]);
  });

  it('asks for its page and the declared size', () => {
    expect(paged.request(paged.parse('?page=3'), undefined)).toEqual({
      page: 3,
      pageSize: 2,
    });
  });

  it('asks for page 1 when the URL names none', () => {
    expect(paged.request(paged.empty, undefined)).toEqual({
      page: 1,
      pageSize: 2,
    });
  });

  it('pages the answer the repository gives', async () => {
    const first = await run(
      makeInMemoryEntityRepository(NOTES).load<Note>(
        paged.request<Note>(paged.parse(''), undefined),
      ),
    );
    const second = await run(
      makeInMemoryEntityRepository(NOTES).load<Note>(
        paged.request<Note>(paged.parse('?page=2'), undefined),
      ),
    );

    expect(first.items).toHaveLength(2);
    expect(second.items.map(note => note.id)).not.toContain(first.items[0]?.id);
  });

  it('is asking, and is not filtering', () => {
    const state = paged.parse('?page=2');
    expect(paged.isAsking(state)).toBe(true);
    expect(paged.isFiltering(state)).toBe(false);
  });

  describe('withParam', () => {
    const onPage3 = paged.parse('?tag=web&sort=newest&note=a&page=3');

    it('drops the page when a filter changes', () => {
      expect(paged.withParam(onPage3, 'tag', ['data'])).toEqual({
        tag: ['data'],
        sort: ['newest'],
        note: ['a'],
        page: [],
      });
    });

    it('drops the page when the sort changes', () => {
      expect(paged.withParam(onPage3, 'sort', []).page).toEqual([]);
    });

    it('keeps the page when only the selection changes', () => {
      expect(paged.withParam(onPage3, 'note', ['b']).page).toEqual(['3']);
    });

    it('sets the page itself, checked the way parse checks it', () => {
      expect(paged.withParam(onPage3, 'page', ['5']).page).toEqual(['5']);
      expect(paged.withParam(onPage3, 'page', ['1']).page).toEqual([]);
      expect(paged.withParam(onPage3, 'page', ['x']).page).toEqual([]);
    });

    it('checks a filter value too', () => {
      const allowed = defineUrlQuery({
        params: { tag: { allowed: ['web'], condition: anyOf('tags') } },
      });
      expect(allowed.withParam(allowed.empty, 'tag', ['gone', 'web'])).toEqual({
        tag: ['web'],
      });
    });
  });

  it('is dropped with the filters', () => {
    expect(
      paged.withoutFilters(paged.parse('?tag=web&sort=newest&page=3')),
    ).toEqual({ tag: [], sort: ['newest'], note: [], page: [] });
  });

  it('leaves a query without one unpaged', () => {
    expect(query.request(query.empty, 'en')).not.toHaveProperty('page');
  });

  describe('refuses a definition it cannot answer', () => {
    it('with two page parameters', () => {
      expect(() =>
        defineUrlQuery({ params: { a: { pageSize: 2 }, b: { pageSize: 3 } } }),
      ).toThrow(/one page parameter at most/);
    });

    it.each([0, -1, 2.5, Number.NaN])('with a pageSize of %s', size => {
      expect(() =>
        defineUrlQuery({ params: { page: { pageSize: size } } }),
      ).toThrow(/positive integer pageSize/);
    });
  });
});
