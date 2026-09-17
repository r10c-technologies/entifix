import type { ExampleCatalog } from './es';

/** The example's own copy, in English. Typed by the Spanish catalog. */
export const en: ExampleCatalog = {
  entity: {
    book: {
      form: { editTitle: 'Edit book', newTitle: 'New book' },
      label: 'Book',
      plural: 'Books',
      fields: {
        id: 'ID',
        title: 'Title',
        author: 'Author',
        year: 'Year',
        status: 'Status',
      },
      values: { status: { available: 'Available', lent: 'Lent' } },
    },
  },
  errors: {
    unexpected: 'Something went wrong. Try again.',
    network: 'Could not reach the service.',
    notFound: 'The book was not found.',
    invalidBody: 'The book is not valid.',
  },
  app: {
    brand: 'entifix · minimal',
    title: 'entifix — minimal example',
    description:
      'One entity end to end: Postgres, an Effect service and the generated screens.',
    nav: { books: 'Books' },
  },
};
