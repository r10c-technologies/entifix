import { ENTIFIX_AREAS } from './areas.js';

describe('ENTIFIX_AREAS', () => {
  it('lists the areas docs/adr/README.md names, in index order', () => {
    expect(ENTIFIX_AREAS).toEqual([
      'entities',
      'adapters',
      'ui',
      'platform',
      'testing',
    ]);
  });
});
