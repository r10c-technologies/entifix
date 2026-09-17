import { accessor, type Entity, entity, type EntityId } from '@entifix/core';

/**
 * What can be sold, and how many are left.
 *
 * `available` is written only by a conditional `$inc` in the saga's reserve
 * step, never read-modify-written: two orders racing for the last unit must
 * not both succeed.
 */
@entity({ domain: 'orders', key: 'stock-item' })
export class StockItem implements Entity {
  #id?: EntityId;
  #sku = '';
  #name = '';
  #available = 0;

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    label: 'SKU',
    required: true,
    filterable: true,
    sortable: true,
  })
  get sku(): string {
    return this.#sku;
  }
  set sku(value: string) {
    this.#sku = value;
  }

  @accessor({ type: 'string', label: 'Name', required: true, filterable: true })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({ type: 'number', label: 'Available', sortable: true })
  get available(): number {
    return this.#available;
  }
  set available(value: number) {
    this.#available = value;
  }
}
