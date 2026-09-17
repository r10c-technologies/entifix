import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@entifix/business';
import { ConfigurationClientInMemory, type Entity } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Context } from 'effect';

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

export const exampleAdapters = {
  customers: Context.make(EntityRepositoryTag, repositories.customers),
  invoices: Context.make(EntityRepositoryTag, repositories.invoices),
  configuration: Context.make(
    ConfigurationRepositoryTag,
    new ConfigurationClientInMemory({}),
  ),
};

export type ExampleAdapters = typeof exampleAdapters;

/** The hook `makeEntityCrud` asks for. Stable identity, no provider needed. */
export const useExampleAdapters = (): ExampleAdapters => exampleAdapters;
