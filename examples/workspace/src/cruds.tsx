'use client';

import { type EntityRepositoryTag, loadUCFactory } from '@entifix/business';
import {
  descendantsOf,
  type EntityId,
  type FilterGroup,
  hierarchyOf,
} from '@entifix/core';
import { Customer, Invoice } from '@entifix/example-workspace-domain';
import { makeEntityCrud } from '@entifix/next-shell';
import { entityQueryScope, useDataLoading } from '@entifix/react-integration';
import { Effect } from 'effect';

import {
  type ExampleAdapters,
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
/** Large enough to hold every account, so the list nests the whole tree. */
const CUSTOMER_PAGE_SIZE = 100;

/** Read once: `Customer` declares a parent, so this is never `undefined`. */
const customerTree = hierarchyOf(Customer);

/**
 * What a customer's parent picker may not offer: the customer itself and every
 * branch beneath it, either of which would make the tree a cycle.
 *
 * A hook because the subtree is other records. It loads the whole set through
 * the same adapters the screens use — the page the list asks for below — and
 * restricts nothing until that set arrives, or on a create, which has no
 * subtree yet.
 */
const useOutsideOwnSubtree = (
  customer: Customer | undefined,
): FilterGroup<Customer> | undefined => {
  const { items } = useDataLoading<Customer, EntityRepositoryTag>({
    uc: loadUCFactory<Customer>(),
    ctx: useExampleAdapters().customers,
    initialPageSize: CUSTOMER_PAGE_SIZE,
    queryKey: entityQueryScope(Customer),
    enabled: customer?.id != null,
  });
  if (customer?.id == null || customerTree === undefined) return undefined;
  const own = String(customer.id);
  return {
    operator: 'and',
    values: [
      {
        property: 'id',
        operator: 'nin',
        values: [own, ...descendantsOf(items, customerTree, own)],
      },
    ],
  };
};

export const customerCrud = makeEntityCrud<Customer, ExampleAdapters>(
  Customer,
  {
    useAdapters: useExampleAdapters,
    basePath: '/customers',
    catalogKey: 'customer',
    repository: 'customers',
    hiddenFields: ['id'],
    metadataSource,
    // The table nests a parent and its children only within one page.
    pageSize: CUSTOMER_PAGE_SIZE,
    links: [
      {
        field: 'parentId',
        entityConstructor: Customer,
        repository: 'customers',
        labelProperty: 'name',
        searchProperty: 'name',
        useBaseFiltering: useOutsideOwnSubtree,
      },
    ],
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
  await Effect.runPromise(program);
};

export const invoiceCrud = makeEntityCrud<Invoice, ExampleAdapters>(Invoice, {
  useAdapters: useExampleAdapters,
  basePath: '/invoices',
  catalogKey: 'invoice',
  repository: 'invoices',
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
