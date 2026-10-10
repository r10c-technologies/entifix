import { describe, expect, it } from 'vitest';

import type { Entity, EntityId } from '../../../types/Entity.js';
import { EntityCollectionLink } from '../entity-collection-link/index.js';
import { EntityLink } from '../entity-link/index.js';
import { targetOf, targetsOf } from './link-targets.js';

class Author implements Entity {
  constructor(public id: EntityId = undefined) {}
}

class Shelf implements Entity {
  constructor(public id: EntityId = undefined) {}
}

describe('targetOf', () => {
  it('reads the record a resolved link names', () => {
    const ada = new Author('ada');
    expect(targetOf(new EntityLink(Author, { value: ada }))).toBe(ada);
  });

  it('refuses a link nothing resolved, naming it', () => {
    expect(() => targetOf(new EntityLink(Author, { id: 'ada' }))).toThrow(
      'The link to Author ada was read before it was resolved',
    );
  });
});

describe('targetsOf', () => {
  it('reads the records a resolved collection names, in its order', () => {
    const shelves = [new Shelf('b'), new Shelf('a')];
    expect(
      targetsOf(new EntityCollectionLink(Shelf, { values: shelves })),
    ).toEqual(shelves);
  });

  it('refuses a collection nothing resolved', () => {
    expect(() =>
      targetsOf(new EntityCollectionLink(Shelf, { ids: ['a'] })),
    ).toThrow('The links to Shelf were read before they were resolved');
  });
});
