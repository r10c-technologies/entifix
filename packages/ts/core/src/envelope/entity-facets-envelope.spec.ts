import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import { accessor } from '../entity-definition/decorators/accessor/index.js';
import { entity } from '../entity-definition/decorators/entity/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import {
  makeEntityEnvelope,
  makeEntityFacetsEnvelope,
} from './make-envelope.js';
import { readEntityFacetsEnvelope } from './read-envelope.js';

@entity({ key: 'gadget' })
class Gadget implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const COUNTS = {
  brand: [
    { value: 'a', count: 2 },
    { value: 3, count: 1 },
    { value: true, count: 1 },
  ],
  seller: [],
};

const failureOf = async (body: unknown) => {
  const exit = await Effect.runPromiseExit(
    readEntityFacetsEnvelope(Gadget, body),
  );
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
};

describe('the entityFacets envelope', () => {
  it('carries the counts as they are, under the entity key', () => {
    expect(makeEntityFacetsEnvelope(Gadget, COUNTS)).toEqual({
      meta: { type: 'entityFacets', entity: 'gadget' },
      data: COUNTS,
    });
  });

  it('reads back what it framed', async () => {
    expect(
      await Effect.runPromise(
        readEntityFacetsEnvelope(
          Gadget,
          makeEntityFacetsEnvelope(Gadget, COUNTS),
        ),
      ),
    ).toEqual(COUNTS);
  });

  it.each([
    ['an envelope of another type', makeEntityEnvelope(Gadget, new Gadget())],
    ['no counts at all', { meta: { type: 'entityFacets' }, data: null }],
    [
      'a member that is not a list',
      { meta: { type: 'entityFacets' }, data: { brand: 1 } },
    ],
    [
      'a row with no count',
      { meta: { type: 'entityFacets' }, data: { brand: [{ value: 'a' }] } },
    ],
    [
      'a row whose value is not a value',
      {
        meta: { type: 'entityFacets' },
        data: { brand: [{ value: {}, count: 1 }] },
      },
    ],
    [
      'a row that is null',
      { meta: { type: 'entityFacets' }, data: { brand: [null] } },
    ],
  ])('refuses %s', async (_, body) => {
    expect(await failureOf(body)).toBeInstanceOf(EntifixBuildError);
  });
});
