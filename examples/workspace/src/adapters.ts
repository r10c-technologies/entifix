import { EntityRepositoryTag } from '@entifix/business';
import { type Entity, type EntityUseCaseRunner, Internal } from '@entifix/core';
import type { Invoice } from '@entifix/example-workspace-domain';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Context, Effect } from 'effect';

import { customerInstances, invoiceInstances } from './seed';

/**
 * Where every screen in this example reads and writes: two repositories held
 * in the page.
 *
 * ⚠️ **This is a test double, used on purpose.** `@entifix/testing-unit`'s
 * repository mirrors the Mongo adapter's filtering, sorting and paging, which is
 * exactly what a UI needs to be exercised without a backend. It is not a
 * production store: a reload keeps the autosaved *drafts* (they are in
 * IndexedDB) and drops every *saved* record back to the seed. A real
 * application passes a REST adapter's `Context` under the same keys, and
 * nothing above this file changes.
 *
 * Module scope, so every screen shares one store for the life of the page —
 * and only the page. A full document load starts again from the seed; every
 * generated link navigates client-side, so only a reload or a typed URL does.
 */
export const repositories = {
  customers: makeInMemoryEntityRepository(customerInstances() as Entity[]),
  invoices: makeInMemoryEntityRepository(invoiceInstances() as Entity[]),
};

/** Puts both repositories back to the seed. */
export const resetRepositories = (): void => {
  repositories.customers.seed(customerInstances() as Entity[]);
  repositories.invoices.seed(invoiceInstances() as Entity[]);
};

/**
 * The invoice's verbs, run in the page against the same repository its screens
 * read — the in-process counterpart of the REST runner a service-backed host
 * passes under this key. `issue` moves a draft to issued; the generated form
 * renders the button because the metadata document lists the verb, and when it
 * resolves the page reloads the record, so the new status shows.
 */
const invoiceVerbs: EntityUseCaseRunner = {
  run: (useCase, id) =>
    useCase.key === 'issue' && id != null
      ? repositories.invoices.get<Invoice>(id).pipe(
          Effect.flatMap(invoice => {
            invoice.status = 'issued';
            return repositories.invoices.save(invoice);
          }),
          Effect.asVoid,
        )
      : Effect.fail(new Internal()),
  // The invoice declares no collection verb.
  bulk: () => Effect.fail(new Internal()),
};

export const exampleAdapters = {
  customers: Context.make(EntityRepositoryTag, repositories.customers),
  invoices: Context.make(EntityRepositoryTag, repositories.invoices),
  invoiceVerbs,
};

export type ExampleAdapters = typeof exampleAdapters;

/** The hook `makeEntityCrud` asks for. Stable identity, no provider needed. */
export const useExampleAdapters = (): ExampleAdapters => exampleAdapters;
