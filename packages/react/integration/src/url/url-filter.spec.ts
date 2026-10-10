import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EntitySource } from './entity-source.js';
import { Note, NOTES, titleIn } from './spec-support/notes.js';
import { useUrlFilter } from './url-filter.js';
import { anyOf, containing, defineUrlQuery } from './url-query.js';

const notes: EntitySource = () =>
  Promise.resolve(makeInMemoryEntityRepository(NOTES));

type Locale = 'en' | 'es';

const query = defineUrlQuery({
  params: {
    tag: { allowed: ['web', 'data'], condition: anyOf('tags') },
    q: {
      single: true,
      condition: containing(titleIn),
    },
  },
});

const sortable = defineUrlQuery({
  params: {
    tag: { condition: anyOf('tags') },
    sort: {
      sorting: {
        oldest: [{ 0: { property: 'writtenAt', type: 'asc' } }],
      },
    },
  },
});

const useNotesFilter = () =>
  useUrlFilter<'tag' | 'q', Locale, Note>(notes, query, 'en');

afterEach(() => {
  window.history.replaceState(null, '', '/en/notes/');
});

describe('useUrlFilter', () => {
  it('shows every record while nothing is filtered', () => {
    const { result } = renderHook(useNotesFilter);
    expect(result.current.filter).toEqual({ tag: [], q: [] });
    expect(result.current.filtering).toBe(false);
    expect(result.current.kept).toBeUndefined();
    expect(result.current.load).toEqual({ status: 'idle' });
  });

  it('keeps the ids the answer to the URL’s filter keeps', async () => {
    window.history.replaceState(null, '', '/en/notes/?tag=data');
    const { result } = renderHook(useNotesFilter);
    expect(result.current.filtering).toBe(true);
    await waitFor(() => expect(result.current.load.status).toBe('done'));
    expect([...(result.current.kept ?? [])]).toEqual(['queries', 'effects']);
  });

  it('toggles a value in and out, and keeps the last answer meanwhile', async () => {
    const { result } = renderHook(useNotesFilter);
    act(() => result.current.toggle('tag', 'web'));
    expect(window.location.search).toBe('?tag=web');
    await waitFor(() => expect(result.current.load.status).toBe('done'));
    expect([...(result.current.kept ?? [])]).toEqual(['static', 'queries']);

    act(() => result.current.toggle('tag', 'data'));
    expect(window.location.search).toBe('?tag=web&tag=data');
    expect(result.current.load.status).toBe('pending');
    expect([...(result.current.kept ?? [])]).toEqual(['static', 'queries']);
    await waitFor(() => expect(result.current.load.status).toBe('done'));

    act(() => result.current.toggle('tag', 'web'));
    expect(window.location.search).toBe('?tag=data');
  });

  it('sets a parameter’s values, and clears every one', async () => {
    const { result } = renderHook(useNotesFilter);
    act(() => result.current.set('q', ['effect']));
    expect(result.current.filter).toEqual({ tag: [], q: ['effect'] });
    await waitFor(() => expect(result.current.load.status).toBe('done'));
    expect([...(result.current.kept ?? [])]).toEqual(['effects']);

    act(() => result.current.clear());
    expect(window.location.search).toBe('');
    expect(result.current.kept).toBeUndefined();
  });

  it('changes nothing before hydration, where it has no filter', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    let seen: ReturnType<typeof useNotesFilter> | undefined;
    const Probe = ({
      onRender,
    }: {
      onRender: (filter: typeof seen) => void;
    }) => {
      onRender(useNotesFilter());
      return null;
    };
    renderToString(
      createElement(Probe, { onRender: filter => (seen = filter) }),
    );
    expect(seen?.filter).toBeNull();
    expect(seen?.filtering).toBe(false);
    seen?.toggle('tag', 'web');
    seen?.set('q', ['x']);
    expect(window.location.search).toBe('');
    // Clearing with no filter read yet writes the empty query.
    window.history.replaceState(null, '', '/en/notes/?tag=web');
    seen?.clear();
    expect(window.location.search).toBe('');
  });

  it('orders every record by a chosen sort alone, which clearing keeps', async () => {
    window.history.replaceState(null, '', '/en/notes/?sort=oldest');
    const { result } = renderHook(() =>
      useUrlFilter<'tag' | 'sort', undefined, Note>(notes, sortable, undefined),
    );
    expect(result.current.filtering).toBe(false);
    await waitFor(() => expect(result.current.load.status).toBe('done'));
    expect(result.current.order).toEqual(['static', 'queries', 'effects']);

    act(() => result.current.toggle('tag', 'data'));
    await waitFor(() =>
      expect(result.current.order).toEqual(['queries', 'effects']),
    );
    act(() => result.current.clear());
    expect(window.location.search).toBe('?sort=oldest');
  });

  it('asks nothing for a selection alone, and keeps it through clearing', () => {
    window.history.replaceState(null, '', '/en/notes/?note=static');
    const selecting = defineUrlQuery({
      params: {
        tag: { condition: anyOf('tags') },
        note: { select: true },
      },
    });
    const { result } = renderHook(() =>
      useUrlFilter<'tag' | 'note', undefined, Note>(
        notes,
        selecting,
        undefined,
      ),
    );
    expect(result.current.filter).toEqual({ tag: [], note: ['static'] });
    expect(result.current.load).toEqual({ status: 'idle' });
    act(() => result.current.set('note', ['queries']));
    act(() => result.current.clear());
    expect(window.location.search).toBe('?note=queries');
  });
});
