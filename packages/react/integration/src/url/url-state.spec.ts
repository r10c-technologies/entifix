import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { anyOf, defineUrlQuery } from './url-query.js';
import { useUrlState } from './url-state.js';

const query = defineUrlQuery({
  params: { tag: { condition: anyOf('tags') } },
});

afterEach(() => {
  window.history.replaceState(null, '', '/en/list/');
});

describe('useUrlState', () => {
  it('reads the state the URL holds', () => {
    window.history.replaceState(null, '', '/en/list/?tag=web');
    const { result } = renderHook(() => useUrlState(query));
    expect(result.current[0]).toEqual({ tag: ['web'] });
  });

  it('writes a state into the URL, replacing the entry, and reads it back', () => {
    const { result } = renderHook(() => useUrlState(query));
    const before = window.history.length;
    act(() => result.current[1]({ tag: ['web', 'data'] }));
    expect(window.location.search).toBe('?tag=web&tag=data');
    expect(window.history.length).toBe(before);
    expect(result.current[0]).toEqual({ tag: ['web', 'data'] });
    act(() => result.current[1](query.empty));
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/en/list/');
  });

  it('follows back and forward', () => {
    const { result } = renderHook(() => useUrlState(query));
    act(() => {
      window.history.pushState(null, '', '/en/list/?tag=data');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toEqual({ tag: ['data'] });
  });

  it('has no state while rendering on the server', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    let seen: unknown = 'unset';
    const Probe = () => {
      seen = useUrlState(query)[0];
      return null;
    };
    renderToString(createElement(Probe));
    expect(seen).toBeNull();
  });

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useUrlState(query));
    const last = result.current;
    unmount();
    act(() => {
      window.history.pushState(null, '', '/en/list/?tag=data');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toBe(last);
  });
});
