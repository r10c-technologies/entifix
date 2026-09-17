import { accessor, type Entity, entity, type EntityId } from '@entifix/core';

export const BOOK_STATUSES = ['available', 'lent'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

/**
 * The one entity the full-stack example carries end to end: declared once here,
 * stored in a Postgres table by `@entifix/sql`, served by the service, and
 * listed and edited by the generated screens in the Next app.
 *
 * Every member name is one lower-case word because each is also a column, and
 * Postgres folds an unquoted identifier to lower case.
 */
@entity({
  domain: 'library',
  key: 'book',
  labelKey: 'entity:book.label',
  pluralKey: 'entity:book.plural',
})
export class Book implements Entity {
  #id?: EntityId;
  #title = '';
  #author = '';
  #year?: number;
  #status: BookStatus = 'available';

  @accessor({ type: 'id', label: 'ID', labelKey: 'entity:book.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    label: 'Title',
    labelKey: 'entity:book.fields.title',
    required: true,
    filterable: true,
    sortable: true,
  })
  get title(): string {
    return this.#title;
  }
  set title(value: string) {
    this.#title = value;
  }

  @accessor({
    type: 'string',
    label: 'Author',
    labelKey: 'entity:book.fields.author',
    required: true,
    filterable: true,
    sortable: true,
  })
  get author(): string {
    return this.#author;
  }
  set author(value: string) {
    this.#author = value;
  }

  @accessor({
    type: 'number',
    label: 'Year',
    labelKey: 'entity:book.fields.year',
    sortable: true,
  })
  get year(): number | undefined {
    return this.#year;
  }
  set year(value: number | undefined) {
    this.#year = value;
  }

  @accessor({
    type: 'enum',
    label: 'Status',
    labelKey: 'entity:book.fields.status',
    enumValues: BOOK_STATUSES,
    enumLabelKey: 'entity:book.values.status',
    required: true,
    filterable: true,
  })
  get status(): BookStatus {
    return this.#status;
  }
  set status(value: BookStatus) {
    this.#status = value;
  }
}
