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

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
});

describe('ThemeScript', () => {
  it('paints a stored theme', () => {
    localStorage.setItem('entifix-theme', 'dark');
    runThemeScript();
    expect(painted()).toBe('dark');
  });

  it('paints and stores the first theme when nothing is stored', () => {
    runThemeScript();
    expect(painted()).toBe('light');
    expect(localStorage.getItem('entifix-theme')).toBe('light');
  });

  it('paints the default given, under the key given', () => {
    localStorage.setItem('site-theme', 'purple');
    runThemeScript({ defaultTheme: 'dark', storageKey: 'site-theme' });
    expect(painted()).toBe('dark');
    expect(localStorage.getItem('site-theme')).toBe('dark');
  });

  it('paints nothing it knows when no theme is registered', () => {
    runThemeScript({ themes: [] });
    expect(painted()).toBe('');
  });

  it('leaves the page unthemed when storage cannot be read', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
    });
    runThemeScript();
    expect(painted()).toBeUndefined();
  });

  it('carries the nonce a policy asks for', () => {
    expect(runThemeScript({ nonce: 'abc' })?.getAttribute('nonce')).toBe('abc');
  });
});
