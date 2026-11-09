import { describe, expect, it } from 'vitest';

import { readThemeCookies } from './theme-cookies.js';

const jar = (values: Record<string, string>) => ({
  get: (name: string) =>
    values[name] === undefined ? undefined : { value: values[name] },
});

describe('readThemeCookies', () => {
  it('reads a stored theme and density', () => {
    expect(
      readThemeCookies(
        jar({
          'entifix-theme': 'midnight',
          'entifix-theme-density': 'compact',
        }),
        { themes: ['aurora', 'midnight'] },
      ),
    ).toEqual({ theme: 'midnight', density: 'compact' });
  });

  it('falls back to the defaults for nothing stored, or something unknown', () => {
    expect(
      readThemeCookies(
        jar({ 'app-theme': 'solar', 'app-theme-density': 'roomy' }),
        {
          themes: ['aurora', 'midnight'],
          defaultTheme: 'midnight',
          defaultDensity: 'comfortable',
          storageKey: 'app-theme',
        },
      ),
    ).toEqual({ theme: 'midnight', density: 'comfortable' });
    expect(readThemeCookies(jar({}), { themes: ['aurora'] })).toEqual({
      theme: 'aurora',
      density: undefined,
    });
    expect(readThemeCookies(jar({}), { themes: [] }).theme).toBe('');
  });
});
