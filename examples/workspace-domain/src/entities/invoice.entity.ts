import { accessor, type Entity, entity, type EntityId } from '@entifix/core';

import { InvoiceLine } from './invoice-line.js';

export const INVOICE_STATUSES = ['draft', 'issued', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * A record that owns rows, and refers to another record by id.
 *
 * `customerId` is a plain string rather than a typed link, declared a
 * reference to `billing:customer`: every screen shows the customer's name in
 * its place, read through the host's reference registry, and the generated
 * form edits it with a picker the crud names (`links` in `../cruds.tsx`).
 */
@entity({
  domain: 'billing',
  key: 'invoice',
  labelKey: 'entity:invoice.label',
  pluralKey: 'entity:invoice.plural',
  labelMember: 'number',
})
export class Invoice implements Entity {
  #id?: EntityId;
  #number = '';
  #customerId?: string;
  #status: InvoiceStatus = 'draft';
  #lines: readonly InvoiceLine[] = [];

  // Filterable, so the payments that name an invoice read its number in one
  // request.
  @accessor({
    type: 'id',
    labelKey: 'entity:invoice.fields.id',
    filterable: true,
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:invoice.fields.number',
    required: true,
    filterable: true,
    sortable: true,
  })
  get number(): string {
    return this.#number;
  }
  set number(value: string) {
    this.#number = value;
  }

  // Filterable, so a customer's list can show its invoices in one request.
  @accessor({
    type: 'string',
    labelKey: 'entity:invoice.fields.customer',
    references: { entity: 'billing:customer' },
    filterable: true,
  })
  get customerId(): string | undefined {
    return this.#customerId;
  }
  set customerId(value: string | undefined) {
    this.#customerId = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:invoice.fields.status',
    enumValues: INVOICE_STATUSES,
    enumLabelKey: 'entity:invoice.values.status',
    required: true,
    filterable: true,
  })
  get status(): InvoiceStatus {
    return this.#status;
  }
  set status(value: InvoiceStatus) {
    this.#status = value;
  }

  @accessor({
    type: 'composition',
    childType: () => InvoiceLine,
    labelKey: 'entity:invoice.fields.lines',
  })
  get lines(): readonly InvoiceLine[] {
    return this.#lines;
  }
  set lines(value: readonly InvoiceLine[]) {
    this.#lines = value;
  }
}
