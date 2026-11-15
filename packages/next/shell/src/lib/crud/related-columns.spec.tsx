import { EntityRepositoryTag } from '@entifix/business';
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  type EntityLoadRequest,
} from '@entifix/core';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { render, screen, waitFor, within } from '@testing-library/react';
import { Context } from 'effect';
import { createContext, useContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeEntityCrud } from './make-entity-crud.js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ locale: 'es' }),
  usePathname: () => '/es/catalog/offering',
  useSearchParams: () => new URLSearchParams(),
}));

/** A record's values, read and written by every accessor below. */
class Values implements Entity {
  values: Record<string, unknown>;
  constructor(values: Record<string, unknown> = {}) {
    this.values = { ...values };
  }
  protected read(name: string): never {
    return this.values[name] as never;
  }
  @accessor({ type: 'id', filterable: true })
  get id(): EntityId {
    return this.read('id');
  }
  set id(value: EntityId) {
    this.values['id'] = value;
  }
}

@entity({
  domain: 'catalog',
  key: 'brand',
  labelKey: 'entity:brand.label',
  pluralKey: 'entity:brand.plural',
})
class Brand extends Values {
  @accessor({ type: 'string', minWidth: 12 })
  get name(): string {
    return this.read('name');
  }
  set name(value: string) {
    this.values['name'] = value;
  }
}

@entity({
  domain: 'catalog',
  key: 'price',
  labelKey: 'entity:price.label',
  pluralKey: 'entity:price.plural',
})
class Price extends Values {
  @accessor({ type: 'string', filterable: true })
  get offeringId(): string {
    return this.read('offeringId');
  }
  set offeringId(value: string) {
    this.values['offeringId'] = value;
  }
  @accessor({
    type: 'number',
    money: { currency: 'GTQ', unit: 'minor' },
    filterable: false,
  })
  get amount(): number {
    return this.read('amount');
  }
  set amount(value: number) {
    this.values['amount'] = value;
  }
  @accessor({ type: 'boolean', filterable: true })
  get active(): boolean {
    return this.read('active');
  }
  set active(value: boolean) {
    this.values['active'] = value;
  }
}

@entity({
  domain: 'catalog',
  key: 'offering',
  labelKey: 'entity:offering.label',
  pluralKey: 'entity:offering.plural',
  labelMember: 'title',
})
class Offering extends Values {
  @accessor({ type: 'string' })
  get title(): string {
    return this.read('title');
  }
  set title(value: string) {
    this.values['title'] = value;
  }
  @accessor({ type: 'string', references: { entity: 'catalog:brand' } })
  get brandId(): string {
    return this.read('brandId');
  }
  set brandId(value: string) {
    this.values['brandId'] = value;
  }
}

interface Adapters {
  offerings: Context.Context<EntityRepositoryTag>;
  prices: Context.Context<EntityRepositoryTag>;
  brands: Context.Context<EntityRepositoryTag>;
}

/** A repository whose loads are recorded. */
function counted(items: Entity[]) {
  const repository = makeInMemoryEntityRepository(items);
  const loads: EntityLoadRequest<Entity>[] = [];
  return {
    loads,
    context: Context.make(EntityRepositoryTag, {
      ...repository,
      load: (request: EntityLoadRequest<Entity>) => {
        loads.push(request);
        return repository.load(request);
      },
    } as never),
  };
}

let prices: ReturnType<typeof counted>;
let brands: ReturnType<typeof counted>;
let offerings: ReturnType<typeof counted>;

beforeEach(() => {
  offerings = counted([
    new Offering({ id: 'o-1', title: 'Flange', brandId: 'b-1' }),
    new Offering({ id: 'o-2', title: 'Bolt', brandId: 'b-404' }),
    new Offering({ id: 'o-3', title: 'Nut' }),
  ]);
  prices = counted([
    new Price({ id: 'p-1', offeringId: 'o-1', amount: 6499, active: true }),
    new Price({ id: 'p-2', offeringId: 'o-2', amount: 100, active: true }),
    new Price({ id: 'p-3', offeringId: 'o-2', amount: 200, active: true }),
    // Retired: the filter leaves it out, so o-3 has no price at all.
    new Price({ id: 'p-4', offeringId: 'o-3', amount: 300, active: false }),
  ]);
  brands = counted([new Brand({ id: 'b-1', name: 'Acme' })]);
});

const useAdapters = (): Adapters => ({
  offerings: offerings.context,
  prices: prices.context,
  brands: brands.context,
});

const offeringCrud = makeEntityCrud<Offering, Adapters>(Offering, {
  useAdapters,
  basePath: '/catalog/offering',
  catalogKey: 'offering',
  repository: 'offerings',
  related: [
    {
      key: 'price',
      labelKey: 'entity:offering.related.price',
      target: Price,
      repository: 'prices',
      match: 'offeringId',
      filtering: {
        operator: 'and',
        values: [{ property: 'active', operator: 'eq', value: true }],
      },
      member: 'amount',
    },
    {
      key: 'brand',
      labelKey: 'entity:offering.related.brand',
      target: Brand,
      repository: 'brands',
      via: 'brandId',
      member: 'name',
      render: brand => <strong>{(brand as Brand).name}</strong>,
    },
  ],
});

describe('a related column (ADR 0030)', () => {
  it('reads each related column once per page, its filter AND-ed with the match', async () => {
    render(
      <EntifixQueryProvider>
        <offeringCrud.ListPage />
      </EntifixQueryProvider>,
    );
    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(within(table).getByText('Acme')).toBeInTheDocument(),
    );

    expect(prices.loads).toHaveLength(1);
    expect(brands.loads).toHaveLength(1);
    expect(prices.loads[0]?.filtering).toEqual([
      {
        operator: 'and',
        values: [
          {
            property: 'offeringId',
            operator: 'in',
            values: ['o-1', 'o-2', 'o-3'],
          },
          {
            operator: 'and',
            values: [{ property: 'active', operator: 'eq', value: true }],
          },
        ],
      },
    ]);
    expect(brands.loads[0]?.filtering).toEqual([
      {
        operator: 'and',
        values: [{ property: 'id', operator: 'in', values: ['b-1', 'b-404'] }],
      },
    ]);
  });

  it('reads one match as its value, many as a count, and none as a dash', async () => {
    render(
      <EntifixQueryProvider>
        <offeringCrud.ListPage />
      </EntifixQueryProvider>,
    );
    const table = await screen.findByRole('table');
    const row = (title: string) =>
      within(table)
        .getByRole('link', { name: title })
        .closest('tr') as HTMLElement;

    // One price: read as money, through the price's own descriptor.
    await waitFor(() =>
      expect(within(row('Flange')).getByText(/64,99/)).toBeInTheDocument(),
    );
    // Two: a count of them.
    expect(within(row('Bolt')).getByText(/^2 /)).toBeInTheDocument();
    // None, and a brand no record answers: a dash each.
    expect(within(row('Nut')).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(row('Bolt')).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('is neither sortable nor a sort button', async () => {
    render(
      <EntifixQueryProvider>
        <offeringCrud.ListPage />
      </EntifixQueryProvider>,
    );
    const table = await screen.findByRole('table');
    const header = within(table).getByRole('columnheader', {
      // The host's catalog holds no such key here, so its path reads.
      name: 'offering.related.price',
    });
    expect(header).not.toHaveAttribute('aria-sort');
    expect(within(header).queryByRole('button')).not.toBeInTheDocument();
  });

  it('is refused when the screen is generated, not on every page', () => {
    const make = (
      related: Parameters<
        typeof makeEntityCrud<Offering, Adapters>
      >[1]['related'],
    ) =>
      makeEntityCrud<Offering, Adapters>(Offering, {
        useAdapters,
        basePath: '/catalog/offering',
        catalogKey: 'offering',
        repository: 'offerings',
        related,
      });
    const base = {
      key: 'x',
      labelKey: 'x',
      target: Price,
      repository: 'prices' as const,
      member: 'amount',
    };
    expect(() => make([base])).toThrow(/exactly one of via and match/);
    expect(() =>
      make([{ ...base, via: 'brandId', match: 'offeringId' }]),
    ).toThrow(/exactly one/);
    expect(() => make([{ ...base, via: 'title' }])).toThrow(
      /not a reference member/,
    );
    expect(() => make([{ ...base, match: 'amount' }])).toThrow(
      /filterable member/,
    );
    expect(() =>
      make([{ ...base, match: 'offeringId', member: 'nope' }]),
    ).toThrow(/not a member/);
    expect(() =>
      make([
        {
          ...base,
          match: 'offeringId',
          filtering: {
            operator: 'and',
            values: [{ property: 'amount', operator: 'eq', value: 1 }],
          },
        },
      ]),
    ).toThrow();
  });
});

/**
 * A provider another slice mounts above the crud, holding a repository this
 * shell may not build — the stock beside an offering list.
 */
const StockContext = createContext<
  Context.Context<EntityRepositoryTag> | undefined
>(undefined);
const useStock = () => {
  const stock = useContext(StockContext);
  if (stock === undefined) throw new Error('No stock provider.');
  return stock;
};

describe('a related column the host supplies a repository for', () => {
  const pricedThroughHost = makeEntityCrud<Offering, Adapters>(Offering, {
    useAdapters,
    basePath: '/catalog/offering',
    catalogKey: 'offering',
    repository: 'offerings',
    related: [
      {
        key: 'hostPrice',
        labelKey: 'entity:offering.related.price',
        target: Price,
        repository: { useRepository: useStock },
        match: 'offeringId',
        member: 'amount',
      },
    ],
  });

  it('reads through the supplied repository, once per page, and not the adapters', async () => {
    const supplied = counted([
      new Price({ id: 'p-9', offeringId: 'o-1', amount: 1250, active: true }),
    ]);
    render(
      <EntifixQueryProvider>
        <StockContext.Provider value={supplied.context}>
          <pricedThroughHost.ListPage />
        </StockContext.Provider>
      </EntifixQueryProvider>,
    );
    const table = await screen.findByRole('table');
    const link = await within(table).findByRole('link', { name: 'Flange' });
    const row = link.closest('tr') as HTMLElement;

    await waitFor(() =>
      expect(within(row).getByText(/12,50/)).toBeInTheDocument(),
    );
    expect(supplied.loads).toHaveLength(1);
    expect(prices.loads).toHaveLength(0);
  });
});
