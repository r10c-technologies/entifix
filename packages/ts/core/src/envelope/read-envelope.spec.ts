import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { accessor } from '../entity-definition/decorators/accessor/index.js';
import { entity } from '../entity-definition/decorators/entity/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import { matchesEventPattern } from './event-pattern.js';
import {
  envelopeEntityName,
  makeEntityCollectionEnvelope,
  makeEntityPageEnvelope,
  makeEnvelope,
  makeEventEnvelope,
} from './make-envelope.js';
import { readEntityPageEnvelope } from './read-envelope.js';
import type { DomainEvent } from './types.js';

/** No `key`, so `meta.entity` must fall back to the class name. */
@entity()
class Unkeyed implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

describe('envelopeEntityName', () => {
  it('falls back to the class name when the entity declares no key', () => {
    expect(envelopeEntityName(Unkeyed)).toBe('Unkeyed');
  });
});

describe('makeEnvelope', () => {
  // Commands and transaction events carry their own `data` shapes, so they
  // cannot go through the entity builders — but they must frame identically.
  it('frames an arbitrary payload with meta.type and meta.entity', () => {
    expect(makeEnvelope('command', 'product', { code: 'P-1' })).toEqual({
      meta: { type: 'command', entity: 'product' },
      data: { code: 'P-1' },
    });
  });

  it('carries links when supplied and omits the key otherwise', () => {
    const links = [
      { rel: 'self', href: '/api/product', method: 'GET' as const },
    ];

    expect(makeEnvelope('command', 'product', {}, links).meta.links).toEqual(
      links,
    );
    expect(makeEnvelope('command', 'product', {}).meta).not.toHaveProperty(
      'links',
    );
  });
});

describe('makeEntityCollectionEnvelope', () => {
  it('carries links when supplied', () => {
    const links = [
      { rel: 'self', href: '/api/unkeyed', method: 'GET' as const },
    ];

    expect(makeEntityCollectionEnvelope(Unkeyed, [], links).meta.links).toEqual(
      links,
    );
  });
});

describe('makeEntityPageEnvelope', () => {
  it('carries links when supplied', () => {
    const links = [
      { rel: 'next', href: '/api/unkeyed?page=2', method: 'GET' as const },
    ];
    const page = { items: [], total: 0, request: {} };

    expect(makeEntityPageEnvelope(Unkeyed, page, links).meta.links).toEqual(
      links,
    );
  });
});

describe('readEntityPageEnvelope', () => {
  it('echoes the request the page answered, and defaults an absent one', () => {
    const read = (request?: object) =>
      Effect.runSync(
        readEntityPageEnvelope(Unkeyed, {
          meta: { type: 'entityPage', entity: 'Unkeyed' },
          data: { items: [], total: 0, ...(request ? { request } : {}) },
        }),
      );

    expect(read({ size: 5 }).request).toEqual({ size: 5 });
    expect(read().request).toEqual({});
  });
});

describe('event envelopes', () => {
  const anEvent = (
    overrides: Partial<DomainEvent<{ sku: string }>> = {},
  ): DomainEvent<{ sku: string }> => ({
    name: 'catalog.published',
    id: 'evt-1',
    source: 'marketplace-admin',
    at: '2026-01-01T00:00:00.000Z',
    correlationId: 'tx-1',
    data: { sku: 'W-1' },
    ...overrides,
  });

  // The split the whole envelope exists for: metadata describes the message,
  // `data` describes what happened, and a consumer never has to dig through one
  // to find the other.
  it('frames metadata under meta.event and the payload under data', () => {
    expect(makeEventEnvelope(anEvent())).toEqual({
      meta: {
        type: 'event',
        event: {
          name: 'catalog.published',
          id: 'evt-1',
          source: 'marketplace-admin',
          at: '2026-01-01T00:00:00.000Z',
          correlationId: 'tx-1',
        },
      },
      data: { sku: 'W-1' },
    });
  });

  // A bus message is about an occurrence, not necessarily about an entity —
  // `settlement.run.completed` is about a run. Inventing a label here is what
  // the old required `meta.entity` forced.
  it('sets no entity label', () => {
    expect(makeEventEnvelope(anEvent()).meta).not.toHaveProperty('entity');
  });
});

describe('matchesEventPattern', () => {
  // AMQP topic semantics, which the broker applies in production. The point of
  // having them here is that the in-memory bus and the register check route the
  // same way the exchange does.
  it.each([
    ['an exact name', 'catalog.published', 'catalog.published', true],
    ['a different name', 'catalog.published', 'catalog.retired', false],
    ['* against one word', 'transaction.*', 'transaction.completed', true],
    [
      '* against two words',
      'transaction.*',
      'transaction.step.completed',
      false,
    ],
    ['* against zero words', 'transaction.*', 'transaction', false],
    ['# against one word', 'transaction.#', 'transaction.completed', true],
    ['# against two words', 'transaction.#', 'transaction.step.done', true],
    ['# against zero words', 'transaction.#', 'transaction', true],
    ['a bare #', '#', 'anything.at.all', true],
    ['a leading *', '*.published', 'catalog.published', true],
    ['a shorter name', 'catalog.published', 'catalog', false],
    ['a longer name', 'catalog', 'catalog.published', false],
    ['# in the middle', 'a.#.d', 'a.b.c.d', true],
    ['# in the middle, no match', 'a.#.d', 'a.b.c.e', false],
  ])('matches %s', (_label, pattern, name, expected) => {
    expect(matchesEventPattern(pattern, name)).toBe(expected);
  });
});
