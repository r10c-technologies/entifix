import { accessor, type Entity, entity, type EntityId } from '@entifix/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EntityTable } from './entity-table.js';

/**
 * A record with nothing that reads as words: a status, a quantity and a date.
 * Its row must still open by a name — the noun and the short id — and never on
 * "3" or "paid", the guess `recordLabel()` stopped making in 0.22.2.
 */
@entity({ key: 'ticket' })
class Ticket implements Entity {
  #id?: EntityId;
  #status?: string;
  #quantity?: number;
  #openedAt?: Date;

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'enum', label: 'Status', enumValues: ['open', 'paid'] })
  get status(): string | undefined {
    return this.#status;
  }
  set status(value: string | undefined) {
    this.#status = value;
  }

  @accessor({ type: 'number', label: 'Quantity' })
  get quantity(): number | undefined {
    return this.#quantity;
  }
  set quantity(value: number | undefined) {
    this.#quantity = value;
  }

  @accessor({ type: 'date', label: 'Opened' })
  get openedAt(): Date | undefined {
    return this.#openedAt;
  }
  set openedAt(value: Date | undefined) {
    this.#openedAt = value;
  }
}

/** A record that names itself, with an optional name some rows leave empty. */
@entity({ key: 'shelf' })
class Shelf implements Entity {
  #id?: EntityId;
  #name?: string;
  #capacity?: number;

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'number', label: 'Capacity' })
  get capacity(): number | undefined {
    return this.#capacity;
  }
  set capacity(value: number | undefined) {
    this.#capacity = value;
  }
}

const ticket = (id: string, status: string, quantity: number) => {
  const item = new Ticket();
  item.id = id;
  item.status = status;
  item.quantity = quantity;
  item.openedAt = new Date('2026-11-15T10:00:00Z');
  return item;
};

const shelf = (id: string, name: string | undefined, capacity: number) => {
  const item = new Shelf();
  item.id = id;
  item.name = name;
  item.capacity = capacity;
  return item;
};

const page = {
  isLoading: false,
  currentPage: 1,
  pageSize: 10,
  onPageChange: () => undefined,
  hrefFor: (id: EntityId) => `/records/${String(id)}`,
};

const gridLinks = () =>
  within(screen.getByRole('table'))
    .getAllByRole('link')
    .map(link => link.textContent);

describe('EntityTable: the row that names nothing', () => {
  const items = [
    ticket('8a564966-1111-4222-8333-944445555666', 'paid', 3),
    ticket('t-2', 'open', 0),
  ];

  it('opens each row by its noun and short id, once', () => {
    render(
      <EntityTable<Ticket>
        {...page}
        entityConstructor={Ticket}
        items={items}
        totalItems={2}
      />,
    );

    expect(gridLinks()).toEqual(['ticket 8a564966', 'ticket t-2']);
    for (const row of within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)) {
      expect(within(row).getAllByRole('link')).toHaveLength(1);
    }
  });

  it('heads the leading column with the noun, and keeps the values plain', () => {
    render(
      <EntityTable<Ticket>
        {...page}
        entityConstructor={Ticket}
        items={items}
        totalItems={2}
      />,
    );

    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map(cell => cell.textContent);
    expect(headers[0]).toBe('ticket');
    expect(headers).not.toContain('ID');
    const table = screen.getByRole('table');
    expect(
      within(table).queryByRole('link', { name: /paid|^3$/i }),
    ).not.toBeInTheDocument();
  });

  it('names the card by the same label', () => {
    render(
      <EntityTable<Ticket>
        {...page}
        entityConstructor={Ticket}
        items={items}
        totalItems={2}
      />,
    );

    const [first] = screen.getAllByRole('listitem');
    expect(
      within(first as HTMLElement).getByRole('link', {
        name: 'ticket 8a564966',
      }),
    ).toBeInTheDocument();
  });
});

describe('EntityTable: a row whose name is empty', () => {
  it('still opens by its name column, reading as its label', () => {
    render(
      <EntityTable<Shelf>
        {...page}
        entityConstructor={Shelf}
        items={[shelf('s-1', 'Top', 4), shelf('s-2', undefined, 7)]}
        totalItems={2}
      />,
    );

    expect(gridLinks()).toEqual(['Top', 'shelf s-2']);
    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map(cell => cell.textContent);
    expect(headers).toEqual(['Name', 'Capacity']);
  });

  it('adds the record column when the reader withholds the name', () => {
    render(
      <EntityTable<Shelf>
        {...page}
        entityConstructor={Shelf}
        items={[shelf('s-1', 'Top', 4)]}
        totalItems={1}
        hiddenColumns={['name']}
      />,
    );

    // The record's name still opens it, from the column that reads as it.
    expect(gridLinks()).toEqual(['Top']);
  });
});
