import { EntityFacetCounterTag, EntityRepositoryTag } from '@entifix/business';
import {
  countFacets,
  type Entity,
  type EntityFacetQuery,
  type EntityUseCaseRunner,
  Internal,
  settled,
} from '@entifix/core';
import type { Invoice } from '@entifix/example-workspace-domain';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Context, Effect } from 'effect';

import { hasOrganization, NoActiveOrganization } from './organization';
import { customerInstances, invoiceInstances, paymentInstances } from './seed';

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
  payments: makeInMemoryEntityRepository(paymentInstances() as Entity[]),
};

/** Puts every repository back to the seed. */
export const resetRepositories = (): void => {
  repositories.customers.seed(customerInstances() as Entity[]);
  repositories.invoices.seed(invoiceInstances() as Entity[]);
  repositories.payments.seed(paymentInstances() as Entity[]);
};

/**
 * The invoice's verbs, run in the page against the same repository its screens
 * read — the in-process counterpart of the REST runner a service-backed host
 * passes under this key. `issue`, `void` and `reopen` move an invoice's
 * status; the generated screens render each because the metadata document
 * lists it, and reload once it resolves, so the new status shows.
 */
const STATUS_AFTER: Readonly<Record<string, Invoice['status']>> = {
  issue: 'issued',
  void: 'void',
  reopen: 'draft',
};

const invoiceVerbs: EntityUseCaseRunner = {
  run: (useCase, id) => {
    const status = STATUS_AFTER[useCase.key];
    return status !== undefined && id != null
      ? repositories.invoices.get<Invoice>(id).pipe(
          Effect.flatMap(invoice => {
            invoice.status = status;
            return repositories.invoices.save(invoice);
          }),
          Effect.map(settled),
        )
      : Effect.fail(new Internal());
  },
  // `purge-drafts` deletes every draft — the toolbar sends the list's whole
  // matching set, and the drafts in it are what goes.
  bulk: useCase =>
    useCase.key === 'purge-drafts'
      ? Effect.forEach(
          (repositories.invoices.items as Invoice[]).filter(
            invoice => invoice.status === 'draft',
          ),
          invoice =>
            repositories.invoices
              .delete(invoice.id)
              .pipe(Effect.as({ id: invoice.id, ok: true })),
        )
      : Effect.fail(new Internal()),
};

export const exampleAdapters = {
  // A tenant read: refused while no organization is chosen.
  customers: Context.make(EntityRepositoryTag, {
    ...repositories.customers,
    load: request =>
      hasOrganization()
        ? repositories.customers.load(request)
        : Effect.fail(new NoActiveOrganization()),
  }),
  invoices: Context.make(EntityRepositoryTag, repositories.invoices),
  payments: Context.make(EntityRepositoryTag, repositories.payments),
  invoiceVerbs,
  // Counted over the same repository the list reads, the in-process
  // counterpart of the REST client's facets adapter.
  invoiceFacets: Context.make(EntityFacetCounterTag, {
    count: queries =>
      Effect.sync(() =>
        countFacets(
          repositories.invoices.items,
          // The port is generic over the entity; this store holds one.
          queries as unknown as readonly EntityFacetQuery[],
        ),
      ),
  }),
};

export type ExampleAdapters = typeof exampleAdapters;

/** The hook `makeEntityCrud` asks for. Stable identity, no provider needed. */
export const useExampleAdapters = (): ExampleAdapters => exampleAdapters;
