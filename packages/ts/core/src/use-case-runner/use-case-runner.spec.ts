import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  accessor,
  describeEntityUseCases,
  type Entity,
  entity,
  type EntityId,
  extractUseCase,
  Failure,
  useCase,
} from '../index.js';
import { verbPath } from './use-case-runner.js';

@entity({ domain: 'shop', key: 'parcel' })
class Parcel implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

class AlreadyShipped extends Failure.conflict<AlreadyShipped>()(
  'SpecAlreadyShipped',
  'specAlreadyShipped',
) {}

@useCase({
  entity: Parcel,
  key: 'ship',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'ship',
  payload: Schema.Struct({ carrier: Schema.String }),
  success: Schema.Struct({ trackingId: Schema.String }),
  errors: [AlreadyShipped],
})
class ShipParcel {}

/** The same verb over a selection: one key, a second binding. */
@useCase({
  entity: Parcel,
  key: 'ship',
  binding: 'collection',
  placement: 'context-dependent',
  labelKey: 'ship',
})
class ShipParcels {}

describe('verbPath', () => {
  it('puts a record verb under the record and the others under the collection', () => {
    expect(verbPath('parcel', 'ship', 'entity')).toBe('/api/parcel/:id/ship');
    expect(verbPath('parcel', 'ship-all', 'collection')).toBe(
      '/api/parcel/ship-all',
    );
    expect(verbPath('parcel', 'reindex', 'unbound')).toBe(
      '/api/parcel/reindex',
    );
  });
});

describe('extractUseCase', () => {
  it('reads a verb’s declaration, its endpoint contract included', () => {
    const declared = extractUseCase(ShipParcel);

    expect(declared.entity).toBe(Parcel);
    expect(declared.key).toBe('ship');
    expect(declared.errors).toEqual([AlreadyShipped]);
    expect(declared.payload).toBeDefined();
    expect(declared.success).toBeDefined();
  });

  it('tells two verbs under one key apart by their binding', () => {
    expect(extractUseCase(ShipParcel).binding).toBe('entity');
    expect(extractUseCase(ShipParcels).binding).toBe('collection');
  });

  it('keeps the contract out of the described verb', () => {
    const [described] = describeEntityUseCases(Parcel);

    expect(described).not.toHaveProperty('payload');
    expect(described).not.toHaveProperty('errors');
  });
});
