import { describe, expect, it } from 'vitest';

import { accessor } from '../entity-definition/decorators/accessor/index.js';
import { entity } from '../entity-definition/decorators/entity/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import { applySorting } from './in-memory-query.js';
import {
  isRelevance,
  RELEVANCE,
  RELEVANCE_ELSEWHERE,
  RELEVANCE_PREFIX,
  RELEVANCE_WORD,
  relevanceLabelKey,
  relevanceScore,
  relevanceTerms,
} from './relevance.js';

@entity({ key: 'case', labelMember: 'name' })
class Case implements Entity {
  #id?: EntityId;
  #name = '';
  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
  @accessor({ type: 'string', sortable: true })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }
}

const item = (id: string, name: string) =>
  Object.assign(new Case(), { id, name });

describe('relevanceTerms', () => {
  it('collects every like value, through arrays and groups', () => {
    expect(
      relevanceTerms([
        { property: 'search', operator: 'like', value: 'funda' },
        {
          operator: 'and',
          values: [
            { property: 'search', operator: 'like', value: 'negra' },
            { property: 'size', operator: 'eq', value: 3 },
            { property: 'search', operator: 'like', value: '' },
          ],
        },
        // An `in` carries values too, and they are not words.
        { property: 'tag', operator: 'in', values: ['like'] },
      ] as never),
    ).toEqual(['funda', 'negra']);
    expect(relevanceTerms(undefined)).toEqual([]);
    expect(relevanceTerms([null, 'x'] as never)).toEqual([]);
  });
});

describe('relevanceScore', () => {
  it('weighs a label prefix over a word start over anywhere else', () => {
    expect(relevanceScore('Funda negra', ['funda'])).toBe(RELEVANCE_PREFIX);
    expect(relevanceScore('Gran funda', ['FUNDA'])).toBe(RELEVANCE_WORD);
    expect(relevanceScore('Superfunda', ['funda'])).toBe(RELEVANCE_ELSEWHERE);
    // Accent-blind, as like is, and summed over the words.
    expect(relevanceScore('Café oscuro', ['cafe', 'osc'])).toBe(
      RELEVANCE_PREFIX + RELEVANCE_WORD,
    );
  });

  it('scores nothing without a label or without words', () => {
    expect(relevanceScore(undefined, ['funda'])).toBe(0);
    expect(relevanceScore('Funda', [])).toBe(0);
  });

  it('knows its own key', () => {
    expect(isRelevance(RELEVANCE)).toBe(true);
    expect(isRelevance('name')).toBe(false);
  });
});

describe('applySorting by relevance', () => {
  const records = [
    item('a', 'Batería con funda'),
    item('b', 'Superfunda'),
    item('c', 'Funda azul'),
    item('d', 'Funda negra'),
  ];
  const like = [
    { property: 'name', operator: 'like', value: 'funda' },
  ] as never;

  it('ranks the best match first, then breaks ties on the next key', () => {
    expect(
      applySorting(
        records,
        [
          {
            0: { property: RELEVANCE, type: 'desc' },
            1: { property: 'name', type: 'desc' },
          },
        ],
        like,
      ).map(one => one.id),
    ).toEqual(['d', 'c', 'a', 'b']);
  });

  it('falls to the next key with no words, or no label to score', () => {
    const sorting = [
      {
        0: { property: RELEVANCE, type: 'desc' },
        1: { property: 'id', type: 'desc' },
      },
    ] as never;
    expect(applySorting(records, sorting).map(one => one.id)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
    const plain = [{ id: 'x' }, { id: 'y' }] as Entity[];
    expect(applySorting(plain, sorting, like).map(one => one.id)).toEqual([
      'y',
      'x',
    ]);
  });
});

@entity({ key: 'aliased', labelMember: 'title' })
class Aliased implements Entity {
  #id?: EntityId;
  #title = '';
  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
  @accessor({ type: 'string', alias: 'display_title' })
  get title(): string {
    return this.#title;
  }
  set title(value: string) {
    this.#title = value;
  }
}

@entity({ key: 'unlabelled' })
class Unlabelled implements Entity {
  #id?: EntityId;
  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

describe('relevanceLabelKey', () => {
  it('names the label member under the key a store holds it by', () => {
    expect(relevanceLabelKey(Case)).toBe('name');
    expect(relevanceLabelKey(Aliased)).toBe('display_title');
    expect(relevanceLabelKey(Unlabelled)).toBeUndefined();
  });
});
