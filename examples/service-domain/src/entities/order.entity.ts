import { accessor, type Entity, entity, type EntityId } from '@entifix/core';

export const ORDER_STATUSES = ['confirmed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * A placed order. It only ever exists confirmed: the saga writes it as its last
 * step, after the stock is held and the charge taken, so there is no pending
 * order to clean up when an earlier step refuses.
 */
@entity({ domain: 'orders', key: 'order' })
export class Order implements Entity {
  #id?: EntityId;
  #sku = '';
  #quantity = 0;
  #amount = 0;
  #status: OrderStatus = 'confirmed';
  #sagaId = '';

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'SKU', filterable: true })
  get sku(): string {
    return this.#sku;
  }
  set sku(value: string) {
    this.#sku = value;
  }

  @accessor({ type: 'number', label: 'Quantity' })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  @accessor({ type: 'number', label: 'Amount' })
  get amount(): number {
    return this.#amount;
  }
  set amount(value: number) {
    this.#amount = value;
  }

  @accessor({
    type: 'enum',
    label: 'Status',
    enumValues: ORDER_STATUSES,
    filterable: true,
  })
  get status(): OrderStatus {
    return this.#status;
  }
  set status(value: OrderStatus) {
    this.#status = value;
  }

  @accessor({ type: 'string', label: 'Saga' })
  get sagaId(): string {
    return this.#sagaId;
  }
  set sagaId(value: string) {
    this.#sagaId = value;
  }
}
