import { accessor, type Entity, entity, type EntityId } from '@entifix/core';

export const PAYMENT_METHODS = ['card', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * A record no person creates: a payment is written when money arrives, never
 * typed into a form. `creatable: false` is what says so, and its list offers no
 * "New" to anybody — the same list a caller who may write it reads.
 */
@entity({
  domain: 'billing',
  key: 'payment',
  labelKey: 'entity:payment.label',
  pluralKey: 'entity:payment.plural',
  creatable: false,
})
export class Payment implements Entity {
  #id?: EntityId;
  #reference = '';
  #invoiceId?: string;
  #amount = 0;
  #method: PaymentMethod = 'card';

  @accessor({ type: 'id', labelKey: 'entity:payment.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:payment.fields.reference',
    required: true,
    filterable: true,
    sortable: true,
  })
  get reference(): string {
    return this.#reference;
  }
  set reference(value: string) {
    this.#reference = value;
  }

  @accessor({ type: 'string', labelKey: 'entity:payment.fields.invoice' })
  get invoiceId(): string | undefined {
    return this.#invoiceId;
  }
  set invoiceId(value: string | undefined) {
    this.#invoiceId = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:payment.fields.amount',
    sortable: true,
  })
  get amount(): number {
    return this.#amount;
  }
  set amount(value: number) {
    this.#amount = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:payment.fields.method',
    enumValues: PAYMENT_METHODS,
    enumLabelKey: 'entity:payment.values.method',
    filterable: true,
  })
  get method(): PaymentMethod {
    return this.#method;
  }
  set method(value: PaymentMethod) {
    this.#method = value;
  }
}
