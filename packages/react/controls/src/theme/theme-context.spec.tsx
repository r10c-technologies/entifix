import { Unavailable } from '@entifix/core';
import { act, render, renderHook, screen } from '@testing-library/react';
import { Effect } from 'effect';
import { type PropsWithChildren, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiPreferencesProvider } from '../preferences/ui-preferences-context.js';
import type { UiPreferencesState } from '../preferences/ui-preferences-state.js';
import { ThemeProvider, useOptionalTheme, useTheme } from './theme-context.js';
import type { ThemeOption, ThemePalette } from './types.js';

/**
 * Derived, the way the provider derives it (`${storageKey}-runtime-palettes`),
 * rather than written out. Hardcoding the full id made a spec that overrode
 * `storageKey` look for a style element that was never going to exist.
 */
const DEFAULT_STORAGE_KEY = 'entifix-theme';

/** The document's cookies, as a spec reads and sets them. */
const setCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/`;
};
const cookie = (name: string): string | null =>
  document.cookie
    .split('; ')
    .find(pair => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null;
const clearCookies = () => {
  for (const pair of document.cookie.split('; ')) {
    const name = pair.split('=')[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
};

const PALETTES_STYLE_ID = `${DEFAULT_STORAGE_KEY}-runtime-palettes`;

// The three tokens a runtime palette must state (ADR 0025).
const REQUIRED = {
  'focus-ring': '#123456',
  'border-control': '#654321',
  selected: '#abcdef',
} as const;

const themes: ThemeOption[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const wrapper =
  (props: Partial<Parameters<typeof ThemeProvider>[0]> = {}) =>
  ({ children }: PropsWithChildren) => (
    <ThemeProvider themes={themes} {...props}>
      {children}
    </ThemeProvider>
  );

beforeEach(() => {
  clearCookies();
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['density'];
});

afterEach(() => {
  vi.restoreAllMocks();
  document.getElementById(PALETTES_STYLE_ID)?.remove();
});

describe('ThemeProvider', () => {
  it('starts on the first declared theme', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    expect(result.current.theme).toBe('light');
    expect(result.current.themes).toBe(themes);
  });

  it('honours an explicit default', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: wrapper({ defaultTheme: 'dark' }),
    });

    expect(result.current.theme).toBe('dark');
  });

  it('falls back to an empty theme when none were declared', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <ThemeProvider themes={[]}>{children}</ThemeProvider>
      ),
    });

    expect(result.current.theme).toBe('');
  });

  it('reflects the active theme onto the document', () => {
    renderHook(() => useTheme(), {
      wrapper: wrapper({ defaultTheme: 'dark' }),
    });

    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  // Writing the default was the bug: under StrictMode it landed before the
  // stored value was read back, and the stored theme was lost.
  it('never writes a default to storage', () => {
    renderHook(() => useTheme(), {
      wrapper: wrapper({ defaultTheme: 'dark', defaultDensity: 'compact' }),
    });

    expect(cookie('entifix-theme')).toBeNull();
    expect(cookie('entifix-theme-density')).toBeNull();
  });

  it('namespaces a choice by the given storage key', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: wrapper({ storageKey: 'admin-theme' }),
    });

    act(() => result.current.setTheme('dark'));
    act(() => result.current.setDensity('compact'));

    expect(cookie('admin-theme')).toBe('dark');
    expect(cookie('admin-theme-density')).toBe('compact');
  });

  it('keeps a stored theme and density when mounted twice, as StrictMode does', () => {
    setCookie('entifix-theme', 'dark');
    setCookie('entifix-theme-density', 'compact');

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <StrictMode>
          <ThemeProvider
            themes={themes}
            defaultTheme="light"
            defaultDensity="comfortable"
          >
            {children}
          </ThemeProvider>
        </StrictMode>
      ),
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.density).toBe('compact');
    expect(cookie('entifix-theme')).toBe('dark');
    expect(cookie('entifix-theme-density')).toBe('compact');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.documentElement.dataset['density']).toBe('compact');
  });

  // For a host with no server to read the cookie: it renders the default and
  // the client corrects after mount. Reading it during render would be a
  // hydration mismatch.
  it('adopts a previously stored preference on mount', () => {
    setCookie('entifix-theme', 'dark');

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    expect(result.current.theme).toBe('dark');
  });

  it.each([
    ['an unknown theme id', 'solarized'],
    ['no stored value at all', null],
  ])('ignores %s in storage', (_label, stored) => {
    if (stored !== null) setCookie('entifix-theme', stored);

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    expect(result.current.theme).toBe('light');
  });

  it('switches theme through setTheme, reflecting and persisting it', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    act(() => result.current.setTheme('dark'));

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(cookie('entifix-theme')).toBe('dark');
  });

  describe('density', () => {
    it('applies the default density, and reports it', () => {
      const { result } = renderHook(() => useTheme(), {
        wrapper: wrapper({ defaultDensity: 'compact' }),
      });

      expect(result.current.density).toBe('compact');
      expect(document.documentElement.dataset['density']).toBe('compact');
    });

    it('leaves the document’s own density alone, and reports it, with no default', () => {
      document.documentElement.dataset['density'] = 'compact';

      const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

      expect(result.current.density).toBe('compact');
      expect(document.documentElement.dataset['density']).toBe('compact');
    });

    it('reports comfortable when nothing says otherwise', () => {
      const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

      expect(result.current.density).toBe('comfortable');
      expect(document.documentElement.dataset['density']).toBeUndefined();
    });

    it('ignores a stored density it does not know', () => {
      setCookie('entifix-theme-density', 'roomy');

      const { result } = renderHook(() => useTheme(), {
        wrapper: wrapper({ defaultDensity: 'comfortable' }),
      });

      expect(result.current.density).toBe('comfortable');
    });

    it('switches through setDensity, reflecting and persisting it', () => {
      const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

      act(() => result.current.setDensity('compact'));

      expect(result.current.density).toBe('compact');
      expect(document.documentElement.dataset['density']).toBe('compact');
      expect(cookie('entifix-theme-density')).toBe('compact');
    });
  });

  it('still applies a choice when cookies are refused', () => {
    // An own property shadows the document's cookie accessor; deleting it
    // brings the accessor back.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => {
        throw new Error('blocked');
      },
      set: () => {
        throw new Error('blocked');
      },
    });
    try {
      const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
      act(() => result.current.setTheme('dark'));

      expect(result.current.theme).toBe('dark');
      expect(document.documentElement.dataset['theme']).toBe('dark');
    } finally {
      delete (document as { cookie?: string }).cookie;
    }
  });

  describe('runtime palettes', () => {
    it('must state the three tokens the contract holds against its surfaces', () => {
      // @ts-expect-error — focus-ring, border-control and selected are required (ADR 0025)
      const partial: ThemePalette = { primary: '#000' };
      const complete: ThemePalette = { ...REQUIRED, primary: '#000' };
      expect([partial, complete]).toHaveLength(2);
    });

    // White-label palettes are injected last in the cascade so they override a
    // static preset defining the same tokens.
    it('injects a style element under the theme selector', () => {
      renderHook(() => useTheme(), {
        wrapper: wrapper({
          palettes: { dark: { ...REQUIRED, primary: '#000', accent: '#fff' } },
        }),
      });

      const style = document.getElementById(PALETTES_STYLE_ID);
      expect(style?.textContent).toContain("[data-theme='dark']");
      expect(style?.textContent).toContain('--color-primary: #000;');
      expect(style?.textContent).toContain('--color-accent: #fff;');
    });

    // A second provider mount must find and rewrite the existing element; a
    // fresh one per mount would leave stale palettes stacked in <head>.
    it('reuses the existing style element rather than stacking them', () => {
      renderHook(() => useTheme(), {
        wrapper: wrapper({
          palettes: { dark: { ...REQUIRED, primary: '#000' } },
        }),
      });

      renderHook(() => useTheme(), {
        wrapper: wrapper({
          palettes: { dark: { ...REQUIRED, primary: '#111' } },
        }),
      });

      expect(document.querySelectorAll(`#${PALETTES_STYLE_ID}`)).toHaveLength(
        1,
      );
      expect(document.getElementById(PALETTES_STYLE_ID)?.textContent).toContain(
        '#111',
      );
    });

    it.each([
      ['no palettes', undefined],
      ['an empty palette map', {}],
    ])('injects nothing for %s', (_label, palettes) => {
      renderHook(() => useTheme(), { wrapper: wrapper({ palettes }) });

      expect(document.getElementById(PALETTES_STYLE_ID)).toBeNull();
    });
  });
});

describe('ThemeProvider and the server', () => {
  it('starts on what the server rendered, so nothing changes after load', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: wrapper({ initialTheme: 'dark', initialDensity: 'compact' }),
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.density).toBe('compact');
  });

  it('copies a choice to the UI-preferences port', async () => {
    const write = vi.fn(() => Effect.void);
    const store = {
      read: () => Effect.succeed(undefined),
      write,
      remove: () => Effect.void,
    } as unknown as UiPreferencesState;
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <UiPreferencesProvider store={store}>
          <ThemeProvider themes={themes}>{children}</ThemeProvider>
        </UiPreferencesProvider>
      ),
    });

    act(() => result.current.setTheme('dark'));
    act(() => result.current.setDensity('compact'));

    expect(write).toHaveBeenCalledWith('theme', 'dark');
    expect(write).toHaveBeenCalledWith('density', 'compact');
  });

  it('shrugs off a port that cannot store it', async () => {
    const store = {
      read: () => Effect.succeed(undefined),
      write: () => Effect.fail(new Unavailable({})),
      remove: () => Effect.void,
    } as unknown as UiPreferencesState;
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <UiPreferencesProvider store={store}>
          <ThemeProvider themes={themes}>{children}</ThemeProvider>
        </UiPreferencesProvider>
      ),
    });

    await act(async () => result.current.setTheme('dark'));
    expect(result.current.theme).toBe('dark');
  });
});

describe('useOptionalTheme', () => {
  it('answers null outside a provider rather than failing', () => {
    expect(renderHook(() => useOptionalTheme()).result.current).toBeNull();
  });
});

describe('useTheme', () => {
  // Without a provider there is no `data-theme` to flip, so a component using
  // the hook would silently render unthemed.
  it('fails outside a ThemeProvider', () => {
    expect(() => renderHook(() => useTheme())).toThrow(
      /must be used within a ThemeProvider/,
    );
  });

  it('is available to any descendant', () => {
    const Consumer = () => <span>{useTheme().theme}</span>;
    render(
      <ThemeProvider themes={themes} defaultTheme="dark">
        <div>
          <Consumer />
        </div>
      </ThemeProvider>,
    );

    expect(screen.getByText('dark')).toBeInTheDocument();
  });
});

describe('ThemeProvider on a page already in its theme', () => {
  it('writes nothing to the document', () => {
    document.documentElement.dataset['theme'] = 'dark';
    document.documentElement.dataset['density'] = 'compact';
    const changes: string[] = [];
    const observer = new MutationObserver(records => {
      for (const record of records) changes.push(String(record.attributeName));
    });
    observer.observe(document.documentElement, { attributes: true });

    renderHook(() => useTheme(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <ThemeProvider
          themes={themes}
          initialTheme="dark"
          initialDensity="compact"
        >
          {children}
        </ThemeProvider>
      ),
    });

    expect(observer.takeRecords().map(record => record.attributeName)).toEqual(
      [],
    );
    expect(changes).toEqual([]);
    observer.disconnect();
  });
});
