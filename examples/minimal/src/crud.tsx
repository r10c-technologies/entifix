'use client';

import { Book } from '@entifix/example-minimal-domain';
import { makeEntityCrud } from '@entifix/next-shell';
import { makeEntityMetadataSource } from '@entifix/rest';

import { type ExampleAdapters, useExampleAdapters } from './adapters';

/**
 * Both screens for `Book`, generated from its own metadata, reading and writing
 * through the service. What Save and Delete offer is what the service's
 * `$metadata` answers for this caller.
 */
export const bookCrud = makeEntityCrud<Book, ExampleAdapters>(Book, {
  useAdapters: useExampleAdapters,
  basePath: '/books',
  catalogKey: 'book',
  repository: 'books',
  configuration: 'configuration',
  hiddenFields: ['id'],
  metadataSource: makeEntityMetadataSource({
    url: name => `/api/${name}/$metadata`,
  }),
});
