import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeScript, type ThemeScriptProps } from './theme-script.js';

const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** Runs the inline script as the browser would, before first paint. */
function runThemeScript(props: Partial<ThemeScriptProps> = {}) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <ThemeScript themes={THEMES} {...props} />,
  );
  const script = host.querySelector('script');
  new Function(script?.textContent ?? '')();
  return script;
}

const painted = () => document.documentElement.dataset['theme'];

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearCookies();
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['density'];
});

describe('ThemeScript', () => {
  it('paints a stored theme', () => {
    setCookie('entifix-theme', 'dark');
    runThemeScript();
    expect(painted()).toBe('dark');
  });

  it('paints a stored density, and leaves the served one when none is stored', () => {
    document.documentElement.dataset['density'] = 'comfortable';
    runThemeScript();
    expect(document.documentElement.dataset['density']).toBe('comfortable');

    setCookie('entifix-theme-density', 'compact');
    runThemeScript();
    expect(document.documentElement.dataset['density']).toBe('compact');

    setCookie('entifix-theme-density', 'roomy');
    document.documentElement.dataset['density'] = 'comfortable';
    runThemeScript();
    expect(document.documentElement.dataset['density']).toBe('comfortable');
  });

  it('paints the first theme when nothing is stored, and stores nothing', () => {
    runThemeScript();
    expect(painted()).toBe('light');
    expect(cookie('entifix-theme')).toBeNull();
  });

  it('paints the default given, under the key given', () => {
    setCookie('site-theme', 'purple');
    runThemeScript({ defaultTheme: 'dark', storageKey: 'site-theme' });
    expect(painted()).toBe('dark');
  });

  it('paints nothing it knows when no theme is registered', () => {
    runThemeScript({ themes: [] });
    expect(painted()).toBe('');
  });

  it('leaves the page unthemed when cookies cannot be read', () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => {
        throw new Error('blocked');
      },
    });
    try {
      runThemeScript();
      expect(painted()).toBeUndefined();
    } finally {
      delete (document as { cookie?: string }).cookie;
    }
  });

  it('carries the nonce a policy asks for', () => {
    expect(runThemeScript({ nonce: 'abc' })?.getAttribute('nonce')).toBe('abc');
  });
});
