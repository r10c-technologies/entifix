'use client';

import { type EntityId } from '@entifix/core';
import { Customer, Invoice } from '@entifix/example-workspace-domain';
import { makeEntityCrud } from '@entifix/next-shell';
import { Effect } from 'effect';

import {
  type ExampleAdapters,
  exampleAdapters,
  repositories,
  useExampleAdapters,
} from './adapters';
import { metadataSource } from './metadata';

/**
 * Every screen for both entities, generated from their own metadata.
 *
 * One call per entity yields the list page, the single view (create, edit,
 * delete, validation, the owned-row grid for `lines`) and the descriptor a
 * workspace tab and a nav entry are built from. Nothing below is per-entity
 * but a constructor, a route and which adapter holds its repository.
 */
export const customerCrud = makeEntityCrud<Customer, ExampleAdapters>(
  Customer,
  {
    useAdapters: useExampleAdapters,
    basePath: '/customers',
    catalogKey: 'customer',
    repository: 'customers',
    configuration: 'configuration',
    hiddenFields: ['id'],
    metadataSource,
  },
);

/**
 * `issue` moves a draft to issued. The generated form renders the button
 * because the metadata document lists the verb and this crud can run it; when
 * the promise resolves the page reloads the record, so the new status shows.
 */
const issueInvoice = async (id: EntityId): Promise<void> => {
  const program = repositories.invoices.get<Invoice>(id).pipe(
    Effect.flatMap(invoice => {
      invoice.status = 'issued';
      return repositories.invoices.save(invoice);
    }),
  );
  await Effect.runPromise(
    program.pipe(
      Effect.provide(exampleAdapters.configuration),
    ) as Effect.Effect<unknown>,
  );
};

export const invoiceCrud = makeEntityCrud<Invoice, ExampleAdapters>(Invoice, {
  useAdapters: useExampleAdapters,
  basePath: '/invoices',
  catalogKey: 'invoice',
  repository: 'invoices',
  configuration: 'configuration',
  hiddenFields: ['id'],
  // A plain id on the record, edited with a picker over the other repository.
  links: [
    {
      field: 'customerId',
      entityConstructor: Customer,
      repository: 'customers',
      labelProperty: 'name',
      searchProperty: 'name',
    },
  ],
  metadataSource,
  runUseCase: async (key, id) => {
    if (key === 'issue') await issueInvoice(id);
  },
});

export const CRUDS = [customerCrud, invoiceCrud] as const;
