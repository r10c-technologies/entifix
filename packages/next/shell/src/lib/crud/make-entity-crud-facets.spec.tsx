import { EntityFacetCounterTag, EntityRepositoryTag } from '@entifix/business';
import {
  accessor,
  countFacets,
  type Entity,
  entity,
  type EntityFacetQuery,
  type EntityId,
} from '@entifix/core';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context, Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { makeEntityCrud } from './make-entity-crud.js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ slug: 'new' }),
}));

@entity({
  key: 'ticket',
  labelKey: 'entity:ticket.label',
  pluralKey: 'entity:ticket.plural',
})
class Ticket implements Entity {
  #id?: EntityId;
  #title?: string;
  #state?: string;

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Title', filterable: true })
  get title(): string | undefined {
    return this.#title;
  }
  set title(value: string | undefined) {
    this.#title = value;
  }

  @accessor({
    type: 'enum',
    label: 'State',
    enumValues: ['open', 'closed'],
    filterable: true,
  })
  get state(): string | undefined {
    return this.#state;
  }
  set state(value: string | undefined) {
    this.#state = value;
  }
}

const ticket = (id: string, title: string, state: string) => {
  const item = new Ticket();
  item.id = id;
  item.title = title;
  item.state = state;
  return item;
};

const records = [
  ticket('t-1', 'Login', 'open'),
  ticket('t-2', 'Search', 'open'),
  ticket('t-3', 'Export', 'closed'),
];

interface Adapters {
  rest: Context.Context<EntityRepositoryTag>;
  facets: Context.Context<EntityFacetCounterTag>;
}

const adapters: Adapters = {
  rest: Context.make(
    EntityRepositoryTag,
    makeInMemoryEntityRepository(records as Entity[]),
  ),
  facets: Context.make(EntityFacetCounterTag, {
    count: queries =>
      Effect.succeed(
        countFacets(
          records as Entity[],
          queries as unknown as EntityFacetQuery[],
        ),
      ),
  }),
};

const crud = makeEntityCrud<Ticket, Adapters>(Ticket, {
  useAdapters: () => adapters,
  basePath: '/tickets',
  catalogKey: 'ticket',
  repository: 'rest',
  facets: 'facets',
});

describe('makeEntityCrud facets', () => {
  it('shows how many records hold each choice in the filter panel', async () => {
    render(
      <EntifixQueryProvider>
        <crud.ListPage />
      </EntifixQueryProvider>,
    );
    await screen.findAllByRole('link', { name: 'Login' });

    await userEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Añadir filtro' }),
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Miembro del filtro' }),
      'state',
    );

    expect(
      await screen.findByRole('option', { name: 'open (2)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'closed (1)' })).toBeVisible();
  });
});
