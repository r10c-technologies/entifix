import {
  defineLocales,
  Failure,
  Forbidden,
  InvalidQuery,
  NotFound,
  problemOf,
  resetLocales,
  Unauthenticated,
  Unavailable,
} from '@entifix/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecordSearchResponse } from './record-search.types.js';
import { createRecordSearchRoute } from './record-search-route.js';
import type { RecordSearchSource } from './record-search-source.js';

/** The service shell's refusal, restated: a host reads it by code. */
class NoActiveOrganization extends Failure.conflict<NoActiveOrganization>()(
  'NoActiveOrganization',
  'noActiveOrganization',
) {}

const cookieValue = vi.fn<() => string | undefined>(() => 'the-token');

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieValue();
        return name === 'entifix_at' && value !== undefined
          ? { name, value }
          : undefined;
      },
    }),
}));

/**
 * Fake sources rather than real declarations: this spec is about the fan-out,
 * and `record-search-source.spec.ts` already owns what a declaration means.
 */
const fakeSource = (
  key: string,
  origin: string,
  total = 1,
): RecordSearchSource => ({
  key,
  entity: key,
  labelKey: `entity:${key}.plural`,
  url: (term, limit, locale) =>
    `${origin}/api/${key}?rsql=${term}&pageSize=${limit}&locale=${locale}`,
  read: (body, locale) =>
    (body as { rows?: unknown[] } | undefined)?.rows === undefined
      ? undefined
      : {
          items: [
            {
              id: `${key}-1`,
              label: `Acme (${locale})`,
              entity: key,
              href: `/${key}/${key}-1`,
            },
          ],
          total,
        },
});

const things = fakeSource('thing', 'http://things.test');
const people = fakeSource('person', 'http://people.test');

const answering = (status: number, body: unknown = { rows: [{}] }) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const stubFetch = (
  handler: (url: string) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> => {
  const mock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(String(input))),
  );
  vi.stubGlobal('fetch', mock);
  return mock as unknown as ReturnType<typeof vi.fn>;
};

const get = async (
  query: string,
  options: Parameters<typeof createRecordSearchRoute>[0] = {
    sources: [things, people],
  },
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  body: RecordSearchResponse;
  response: Response;
}> => {
  const response = await createRecordSearchRoute(options)(
    new Request(`http://app.test/api/search${query}`, { headers }),
  );
  return {
    status: response.status,
    body: (await response.clone().json()) as RecordSearchResponse,
    response,
  };
};

beforeEach(() => defineLocales({ locales: ['es', 'en'], defaultLocale: 'es' }));

afterEach(() => {
  resetLocales();
  vi.unstubAllGlobals();
  cookieValue.mockReturnValue('the-token');
});

describe('createRecordSearchRoute', () => {
  describe('the locale a search runs in', () => {
    it.each([
      ['the one the caller names', '?q=cafe&locale=en', {}, 'en'],
      [
        'the forwarded one, when the caller names none',
        '?q=cafe',
        { 'x-entifix-locale': 'en' },
        'en',
      ],
      [
        'the cookie, when nothing is forwarded',
        '?q=cafe',
        { cookie: 'theme=dark; entifix_locale=en' },
        'en',
      ],
      [
        'the default, past anything undeclared',
        '?q=cafe&locale=fr',
        { 'x-entifix-locale': 'de', cookie: 'entifix_locale=pt' },
        'es',
      ],
      ['the default, when nothing names one', '?q=cafe', {}, 'es'],
    ])('is %s', async (_case, query, headers, locale) => {
      const fetchMock = stubFetch(() => answering(200));

      const { body } = await get(query, { sources: [things] }, headers);

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        `locale=${locale}`,
      );
      expect(body.groups[0]?.items[0]?.label).toBe(`Acme (${locale})`);
    });
  });

  describe('before anything is asked upstream', () => {
    // `catalog-reference` reads are unauthenticated at the service, so without
    // this a signed-out caller gets brand matches and the answer reads as a
    // real search.
    it('refuses a caller with no session, and asks nobody', async () => {
      cookieValue.mockReturnValue(undefined);
      const fetchMock = stubFetch(() => answering(200));

      const { status, body } = await get('?q=acme');

      expect(status).toBe(401);
      expect(body).toMatchObject({ code: 'unauthenticated' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['no term at all', ''],
      ['an empty term', '?q='],
      ['a term of whitespace', '?q=%20%20'],
      ['a one-character term', '?q=a'],
    ])('answers %s without querying anything', async (_case, query) => {
      const fetchMock = stubFetch(() => answering(200));

      const { status, body } = await get(query);

      expect(status).toBe(200);
      expect(body.groups).toEqual([]);
      expect(body.unavailable).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses an unknown source by name, and asks nobody', async () => {
      const fetchMock = stubFetch(() => answering(200));

      const { status, body } = await get('?q=acme&sources=nope');

      expect(status).toBe(400);
      expect(body).toMatchObject({
        code: 'invalidQuery',
        detail: 'unknown search source "nope"',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('a healthy fan-out', () => {
    it('returns one group per source, in declared order', async () => {
      stubFetch(() => answering(200));

      const { status, body } = await get('?q=acme');

      expect(status).toBe(200);
      expect(body.term).toBe('acme');
      expect(body.groups.map(group => group.source)).toEqual([
        'thing',
        'person',
      ]);
      expect(body.groups[0]).toMatchObject({
        entity: 'thing',
        labelKey: 'entity:thing.plural',
        total: 1,
      });
      expect(body.unavailable).toEqual([]);
    });

    it('carries the caller’s token to every source', async () => {
      const fetchMock = stubFetch(() => answering(200));

      await get('?q=acme');

      for (const call of fetchMock.mock.calls) {
        expect((call[1] as RequestInit).headers).toEqual({
          Authorization: 'Bearer the-token',
        });
      }
    });

    it('is never cached — the body is scoped to one principal', async () => {
      stubFetch(() => answering(200));

      const { response } = await get('?q=acme');

      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    // Reachable and empty is a real answer. Silently omitting the group would
    // make it indistinguishable from a source that could not be asked.
    it('keeps a reachable group that matched nothing', async () => {
      stubFetch(() => answering(200, { rows: [] }));

      const { body } = await get('?q=acme&sources=thing');

      expect(body.groups).toHaveLength(1);
      expect(body.unavailable).toEqual([]);
    });
  });

  describe('a source that produces nothing', () => {
    it.each([
      [new InvalidQuery({ reason: 'bad' }), 'invalidQuery', 'invalid'],
      [new Unauthenticated(), 'unauthenticated', 'unauthenticated'],
      [new Forbidden({}), 'forbidden', 'forbidden'],
      [new NotFound({}), 'notFound', 'notFound'],
      [new NoActiveOrganization(), 'noActiveOrganization', 'conflict'],
      [new Unavailable({}), 'unavailable', 'unavailable'],
    ])(
      'reports a %s by its code and category, with the status',
      async (failure, reason, category) => {
        const problem = problemOf(failure);
        stubFetch(url =>
          url.startsWith('http://things.test')
            ? answering(problem.status, problem)
            : answering(200),
        );

        const { body } = await get('?q=acme');

        expect(body.groups.map(group => group.source)).toEqual(['person']);
        expect(body.unavailable).toEqual([
          {
            source: 'thing',
            entity: 'thing',
            reason,
            category,
            status: problem.status,
          },
        ]);
      },
    );

    it('reports an error that is not a problem body as protocol', async () => {
      stubFetch(url =>
        url.startsWith('http://things.test')
          ? answering(500, { error: 'nope' })
          : answering(200),
      );

      const { body } = await get('?q=acme');

      expect(body.unavailable).toEqual([
        {
          source: 'thing',
          entity: 'thing',
          reason: 'protocol',
          category: 'protocol',
          status: 500,
        },
      ]);
    });

    it('reports an error whose body is not JSON as protocol', async () => {
      stubFetch(url =>
        url.startsWith('http://things.test')
          ? new Response('<html>bad gateway</html>', { status: 502 })
          : answering(200),
      );

      const { body } = await get('?q=acme');

      expect(body.unavailable[0]).toMatchObject({
        reason: 'protocol',
        status: 502,
      });
    });

    it('reports a body it cannot read as protocol', async () => {
      stubFetch(url =>
        url.startsWith('http://things.test')
          ? answering(200, { notAPage: true })
          : answering(200),
      );

      const { body } = await get('?q=acme');

      expect(body.unavailable).toEqual([
        {
          source: 'thing',
          entity: 'thing',
          reason: 'protocol',
          category: 'protocol',
          status: 200,
        },
      ]);
    });

    it('reports a body that is not JSON as protocol', async () => {
      stubFetch(url =>
        url.startsWith('http://things.test')
          ? new Response('<html>gateway</html>', { status: 200 })
          : answering(200),
      );

      const { body } = await get('?q=acme');

      expect(body.unavailable[0]).toMatchObject({ reason: 'protocol' });
    });

    // The done-when: one slow service costs one group, not the search.
    it('reports a timeout, and the other source still answers', async () => {
      stubFetch(url => {
        if (url.startsWith('http://things.test')) {
          return Promise.reject(
            Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
          ) as unknown as Response;
        }
        return answering(200);
      });

      const { body } = await get('?q=acme');

      expect(body.unavailable).toEqual([
        {
          source: 'thing',
          entity: 'thing',
          reason: 'timeout',
          category: 'timeout',
        },
      ]);
      expect(body.groups.map(group => group.source)).toEqual(['person']);
    });

    it('reports any other throw as the upstream being unavailable', async () => {
      stubFetch(url => {
        if (url.startsWith('http://things.test')) {
          return Promise.reject(
            new Error('connect ECONNREFUSED'),
          ) as unknown as Response;
        }
        return answering(200);
      });

      const { body } = await get('?q=acme');

      expect(body.unavailable).toEqual([
        {
          source: 'thing',
          entity: 'thing',
          reason: 'upstreamUnavailable',
          category: 'unavailable',
        },
      ]);
    });
  });

  describe('narrowing and limits', () => {
    it('asks only the named source', async () => {
      const fetchMock = stubFetch(() => answering(200));

      const { body } = await get('?q=acme&sources=person');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(body.groups.map(group => group.source)).toEqual(['person']);
    });

    it('ignores empty entries in the source list', async () => {
      const fetchMock = stubFetch(() => answering(200));

      await get('?q=acme&sources=person,');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['clamps a limit above the ceiling', '&limit=999', 'pageSize=20'],
      [
        'falls back on a limit that is not a number',
        '&limit=abc',
        'pageSize=5',
      ],
      ['falls back on a limit below one', '&limit=0', 'pageSize=5'],
      ['honours a limit in range', '&limit=3', 'pageSize=3'],
    ])('%s', async (_case, query, expected) => {
      const fetchMock = stubFetch(() => answering(200));

      await get(`?q=acme&sources=thing${query}`);

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(expected);
    });

    it('honours a host-configured default limit', async () => {
      const fetchMock = stubFetch(() => answering(200));

      await get('?q=acme', { sources: [things], limit: 2 });

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('pageSize=2');
    });

    it('honours a host-configured timeout', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      stubFetch(() => answering(200));

      await get('?q=acme', { sources: [things], timeoutMs: 250 });

      expect(timeout).toHaveBeenCalledWith(250);
      timeout.mockRestore();
    });
  });
});

/**
 * A source searched through a reference: the referenced records whose name
 * matches first, then the records referring to them — two reads, one after
 * the other, under the caller's own session.
 */
describe('a source searched through a reference', () => {
  const stock: RecordSearchSource = {
    key: 'stock',
    entity: 'stock',
    labelKey: 'entity:stock.plural',
    url: () => {
      throw new Error(
        'a source searched through a reference reads its own URL',
      );
    },
    read: (body, _locale, names) =>
      (body as { rows?: string[] } | undefined)?.rows === undefined
        ? undefined
        : {
            items: (body as { rows: string[] }).rows.map(offering => ({
              id: `stock-of-${offering}`,
              label: names?.get(offering) ?? offering,
              entity: 'stock',
              href: `/stock/stock-of-${offering}`,
            })),
            total: (body as { rows: string[] }).rows.length,
          },
    through: {
      url: (term, limit, locale) =>
        `http://offerings.test/api/offering?like=${term}&pageSize=${limit}&locale=${locale}`,
      read: body =>
        (body as { matches?: { id: string; label: string }[] } | undefined)
          ?.matches,
      urlFor: (ids, limit) =>
        `http://stock.test/api/stock?in=${ids.join('|')}&pageSize=${limit}`,
    },
  };

  it('names what it finds by the records it refers to', async () => {
    const fetchMock = stubFetch(url =>
      url.startsWith('http://offerings.test')
        ? answering(200, {
            matches: [
              { id: 'o-2', label: 'Café de altura' },
              { id: 'o-1', label: 'Café molido' },
            ],
          })
        : answering(200, { rows: ['o-2', 'o-1'] }),
    );

    const { body } = await get('?q=cafe', { sources: [stock] });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'http://offerings.test/api/offering?like=cafe&pageSize=5&locale=es',
      'http://stock.test/api/stock?in=o-2|o-1&pageSize=5',
    ]);
    expect(body.groups[0]?.items.map(item => item.label)).toEqual([
      'Café de altura',
      'Café molido',
    ]);
  });

  it('answers an empty group without the second read when nothing matched', async () => {
    const fetchMock = stubFetch(() => answering(200, { matches: [] }));

    const { body } = await get('?q=cafe', { sources: [stock] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.groups).toEqual([
      {
        source: 'stock',
        entity: 'stock',
        labelKey: 'entity:stock.plural',
        items: [],
        total: 0,
      },
    ]);
  });

  it.each([
    [
      'the referenced records could not be read',
      (url: string) =>
        url.startsWith('http://offerings.test')
          ? answering(
              503,
              problemOf(new Unavailable({ dependency: 'offerings' })),
            )
          : answering(200, { rows: [] }),
      { reason: 'unavailable', status: 503 },
    ],
    [
      'the referenced records came back unreadable',
      () => answering(200, { nothing: true }),
      { reason: 'protocol', status: 200 },
    ],
    [
      'the records referring to them could not be read',
      (url: string) =>
        url.startsWith('http://offerings.test')
          ? answering(200, { matches: [{ id: 'o-1', label: 'Café' }] })
          : answering(
              403,
              problemOf(new Forbidden({ permission: 'stock:read' })),
            ),
      { reason: 'forbidden', status: 403 },
    ],
  ])('degrades the group when %s', async (_case, handler, expected) => {
    stubFetch(handler);

    const { body } = await get('?q=cafe', { sources: [stock] });

    expect(body.groups).toEqual([]);
    expect(body.unavailable).toEqual([
      expect.objectContaining({ source: 'stock', ...expected }),
    ]);
  });
});
