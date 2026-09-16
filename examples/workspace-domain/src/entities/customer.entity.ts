import { accessor, type Entity, entity, type EntityId } from '@entifix/core';

export const CUSTOMER_TIERS = ['standard', 'preferred'] as const;
export type CustomerTier = (typeof CUSTOMER_TIERS)[number];

/**
 * A flat record: the shape every generated table and form starts from.
 *
 * Private fields behind `@accessor()` getters and setters, because a field
 * without a getter is invisible to every adapter and every screen. The copy is
 * never written here — each member names a catalog key, and the `entity`
 * namespace in `../catalogs` holds the words.
 */
@entity({
  domain: 'billing',
  key: 'customer',
  labelKey: 'entity:customer.label',
  pluralKey: 'entity:customer.plural',
})
export class Customer implements Entity {
  #id?: EntityId;
  #name = '';
  #email?: string;
  #tier: CustomerTier = 'standard';

  @accessor({ type: 'id', labelKey: 'entity:customer.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:customer.fields.name',
    required: true,
    filterable: true,
    sortable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({ type: 'string', labelKey: 'entity:customer.fields.email' })
  get email(): string | undefined {
    return this.#email;
  }
  set email(value: string | undefined) {
    this.#email = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:customer.fields.tier',
    enumValues: CUSTOMER_TIERS,
    enumLabelKey: 'entity:customer.values.tier',
    required: true,
    filterable: true,
  })
  get tier(): CustomerTier {
    return this.#tier;
  }
  set tier(value: CustomerTier) {
    this.#tier = value;
  }
}
