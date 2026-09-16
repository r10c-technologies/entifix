import { accessor } from '@entifix/core';

/**
 * A row an invoice owns.
 *
 * No `@entity()` and no id: a line has no life outside the invoice that holds
 * it, which is what makes `lines` a composition rather than a link collection.
 * The form edits these in a grid under the record and saves them in the same
 * write.
 */
export class InvoiceLine {
  #description = '';
  #quantity = 1;
  #unitPrice = 0;

  @accessor({
    type: 'string',
    labelKey: 'entity:invoice.lineFields.description',
    required: true,
  })
  get description(): string {
    return this.#description;
  }
  set description(value: string) {
    this.#description = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:invoice.lineFields.quantity',
    required: true,
  })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:invoice.lineFields.unitPrice',
    required: true,
  })
  get unitPrice(): number {
    return this.#unitPrice;
  }
  set unitPrice(value: number) {
    this.#unitPrice = value;
  }
}
