import { describe, expect, it } from 'vitest';

import { fill } from './fill.js';

describe('a catalog string filled in', () => {
  it('replaces each placeholder with its value, numbers included', () => {
    expect(
      fill('Showing {{shown}} of {{total}}', { shown: 3, total: '25' }),
    ).toBe('Showing 3 of 25');
  });

  it('leaves a placeholder with no value as written', () => {
    expect(fill('Remove {{name}}', {})).toBe('Remove {{name}}');
  });
});
