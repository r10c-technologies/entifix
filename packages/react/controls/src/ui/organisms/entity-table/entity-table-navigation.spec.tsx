import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  type EntitySorting,
  type FilterGroup,
} from '@entifix/core';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntityTable } from './entity-table.js';
import { RESULT_ANNOUNCEMENT_DELAY_MS } from './use-result-announcement.js';

@entity({ key: 'gizmo' })
class Gizmo implements Entity {
  #id?: EntityId;
  #name?: string;
  #code?: string;
  #state?: string;
  #active?: boolean;

  @accessor({ type: 'id', label: 'ID', sortable: false })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Name', sortable: true, filterable: true })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'string', label: 'Code', sortable: true })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({
    type: 'enum',
    label: 'State',
    enumValues: ['draft', 'live'],
    filterable: true,
    sortable: false,
  })
  get state(): string | undefined {
    return this.#state;
  }
  set state(value: string | undefined) {
    this.#state = value;
  }

  @accessor({ type: 'boolean', label: 'Active', filterable: true })
  get active(): boolean | undefined {
    return this.#active;
  }
  set active(value: boolean | undefined) {
    this.#active = value;
  }
}

const gizmo = (id: string, name: string) => {
  const item = new Gizmo();
  item.id = id;
  item.name = name;
  return item;
};

type Props = Partial<Parameters<typeof EntityTable<Gizmo>>[0]>;

const baseProps = {
  entityConstructor: Gizmo,
  items: [gizmo('g-1', 'Alpha'), gizmo('g-2', 'Beta')],
  isLoading: false,
  totalItems: 2,
  currentPage: 1,
  pageSize: 10,
  onPageChange: () => undefined,
};

const renderTable = (props: Props = {}) => {
  const view = render(<EntityTable<Gizmo> {...baseProps} {...props} />);
  return {
    ...view,
    rerenderWith: (next: Props) =>
      view.rerender(<EntityTable<Gizmo> {...baseProps} {...next} />),
  };
};

const header = (name: RegExp) => screen.getByRole('columnheader', { name });

beforeEach(() => window.localStorage.clear());

describe('header sort', () => {
  it('sorts by a header button and marks only the primary key', async () => {
    const onSortingChange = vi.fn();
    const sorting: EntitySorting<Gizmo> = {
      0: { property: 'name', type: 'asc' },
      1: { property: 'code', type: 'desc' },
    };
    renderTable({ sorting, onSortingChange });

    expect(header(/Name/)).toHaveAttribute('aria-sort', 'ascending');
    expect(header(/Code/)).not.toHaveAttribute('aria-sort');
    expect(within(header(/ID/)).queryByRole('button')).not.toBeInTheDocument();

    await userEvent.click(within(header(/Name/)).getByRole('button'));
    expect(onSortingChange).toHaveBeenLastCalledWith({
      0: { property: 'name', type: 'desc' },
    });

    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(within(header(/Code/)).getByRole('button'));
    await user.keyboard('{/Shift}');
    expect(onSortingChange).toHaveBeenLastCalledWith({
      0: { property: 'name', type: 'asc' },
    });
  });

  it('says descending on the primary key', () => {
    renderTable({
      sorting: { 0: { property: 'name', type: 'desc' } },
      onSortingChange: vi.fn(),
    });

    expect(header(/Name/)).toHaveAttribute('aria-sort', 'descending');
  });

  it('leaves headers plain where nothing can re-sort', () => {
    renderTable();

    expect(
      within(header(/Name/)).queryByRole('button'),
    ).not.toBeInTheDocument();
  });
});

describe('caption', () => {
  it('states the entity, the count and the sort', () => {
    const { rerenderWith } = renderTable();
    expect(screen.getByRole('table')).toHaveAccessibleName(
      'gizmo · 2 resultados',
    );

    rerenderWith({ sorting: { 0: { property: 'name', type: 'asc' } } });
    expect(screen.getByRole('table')).toHaveAccessibleName(
      'gizmo · 2 resultados · ordenado por Name, ascendente',
    );

    rerenderWith({ sorting: { 0: { property: 'code', type: 'desc' } } });
    expect(screen.getByRole('table')).toHaveAccessibleName(
      /ordenado por Code, descendente/,
    );
  });
});

describe('the status region', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const status = () => screen.getAllByRole('status')[0] as HTMLElement;
  const settle = () =>
    act(() => {
      vi.advanceTimersByTime(RESULT_ANNOUNCEMENT_DELAY_MS);
    });

  it('stays silent on the first load, then says the count once results settle', () => {
    const { rerenderWith } = renderTable({ isLoading: true, items: [] });
    rerenderWith({});
    settle();
    expect(status()).toHaveTextContent('');

    const filtering: FilterGroup<Gizmo> = {
      operator: 'and',
      values: [{ property: 'name', operator: 'like', value: 'Al' }],
    };
    rerenderWith({ filtering, totalItems: 1, items: [gizmo('g-1', 'Alpha')] });
    settle();
    expect(status()).toHaveTextContent('1 resultado');

    rerenderWith({ filtering, totalItems: 0, items: [] });
    settle();
    expect(status()).toHaveTextContent('Sin resultados para estos filtros');
  });

  it('says the same count again for a different query', () => {
    const { rerenderWith } = renderTable();
    rerenderWith({ currentPage: 2 });
    settle();
    const first = status().textContent;
    rerenderWith({ currentPage: 3 });
    settle();

    expect(status().textContent).not.toBe(first);
    expect(status()).toHaveTextContent('2 resultados');
  });
});

describe('panel toggles', () => {
  it('say whether their panel is open and which panel they control', async () => {
    renderTable({
      filtering: {
        operator: 'and',
        values: [{ property: 'name', operator: 'like', value: 'Al' }],
      },
      sorting: { 0: { property: 'name', type: 'asc' } },
    });
    const filters = screen.getByRole('button', { name: 'Filtros' });
    expect(filters).toHaveAttribute('aria-expanded', 'false');
    // The count is shown, not spoken: the chips say which filters.
    expect(filters).toHaveTextContent('Filtros1');
    expect(screen.getByRole('button', { name: 'Orden' })).toHaveTextContent(
      'Orden1',
    );

    await userEvent.click(filters);
    expect(filters).toHaveAttribute('aria-expanded', 'true');
    expect(
      document.getElementById(filters.getAttribute('aria-controls') as string),
    ).toContainElement(screen.getByRole('button', { name: 'Añadir filtro' }));
  });
});

describe('filter chips', () => {
  const filtering: FilterGroup<Gizmo> = {
    operator: 'and',
    values: [
      { property: 'name', operator: 'like', value: 'Al' },
      { property: 'state', operator: 'in', values: ['draft', 'live'] },
      {
        property: 'name',
        operator: 'between',
        start: new Date('2026-01-01'),
        end: new Date('2026-02-01'),
      },
      { property: 'active', operator: 'eq', value: true },
      { property: 'active', operator: 'ne', value: false },
      { property: 'name', operator: 'null' },
      { property: 'gone', operator: 'eq', value: 'x' },
      { operator: 'or', values: [] },
    ] as FilterGroup<Gizmo>['values'],
  };

  it('shows each filter in effect, and removes one', async () => {
    const onFilteringChange = vi.fn();
    renderTable({ filtering, onFilteringChange });

    const chips = screen.getByRole('group', { name: 'Filtros aplicados' });
    expect(chips).toHaveTextContent('Name');
    expect(chips).toHaveTextContent('2026-01-01 – 2026-02-01');
    expect(chips).toHaveTextContent('gone');

    const removeButtons = within(chips).getAllByRole('button', {
      name: /^Quitar filtro: /,
    });
    expect(removeButtons).toHaveLength(7);
    await userEvent.click(removeButtons[0] as HTMLElement);
    expect(onFilteringChange).toHaveBeenCalledWith({
      operator: 'and',
      values: filtering.values.slice(1),
    });
  });

  it('clears every filter at once', async () => {
    const onFilteringChange = vi.fn();
    renderTable({ filtering, onFilteringChange });

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar todo' }));
    expect(onFilteringChange).toHaveBeenCalledWith({
      operator: 'and',
      values: [],
    });
  });

  it('shows nothing when no filter is in effect', () => {
    renderTable({ onFilteringChange: vi.fn() });

    expect(
      screen.queryByRole('group', { name: 'Filtros aplicados' }),
    ).toBeNull();
  });
});

describe('facet counts', () => {
  it('shows how many records hold each choice in the filter panel', async () => {
    renderTable({
      onFilteringChange: vi.fn(),
      facets: {
        state: [{ value: 'draft', count: 3 }],
        active: [{ value: true, count: 2 }],
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Añadir filtro' }),
    );

    const [member] = screen.getAllByRole('combobox', {
      name: 'Miembro del filtro',
    });
    await userEvent.selectOptions(member as HTMLElement, 'state');
    expect(screen.getByRole('option', { name: 'draft (3)' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'live' })).toBeVisible();

    await userEvent.selectOptions(member as HTMLElement, 'active');
    expect(screen.getByRole('option', { name: 'Sí (2)' })).toBeVisible();
  });
});

describe('a declared card title', () => {
  @entity({ key: 'badge' })
  class Badge implements Entity {
    #id?: EntityId;
    #code?: string;
    #name?: string;

    @accessor({ type: 'id', label: 'ID' })
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor({ type: 'string', label: 'Code', card: 'hidden' })
    get code(): string | undefined {
      return this.#code;
    }
    set code(value: string | undefined) {
      this.#code = value;
    }

    @accessor({ type: 'string', label: 'Name', card: 'title', minWidth: 30 })
    get name(): string | undefined {
      return this.#name;
    }
    set name(value: string | undefined) {
      this.#name = value;
    }
  }

  it('links the declared title, and keeps a hidden member off the card', () => {
    const badge = new Badge();
    badge.id = 'b-1';
    badge.code = 'B1';
    badge.name = 'Gold';
    const { container } = render(
      <EntityTable<Badge>
        {...baseProps}
        entityConstructor={Badge}
        items={[badge]}
        totalItems={1}
        hrefFor={id => `/badges/${String(id)}`}
      />,
    );

    const card = screen.getByRole('article', { name: 'Gold' });
    expect(within(card).getByRole('link', { name: 'Gold' })).toBeVisible();
    expect(within(card).queryByText('B1')).not.toBeInTheDocument();
    // The grid links the same column: the row reads as its title.
    expect(
      within(screen.getByRole('table')).getByRole('link', { name: 'Gold' }),
    ).toBeVisible();
    // ID 6 + Code 10 + Name 30 = 46rem, held by `@3xl` (48rem).
    expect(container.innerHTML).toContain('@3xl/entity-table:hidden');
  });
});

describe('card roles', () => {
  @entity({ key: 'contact' })
  class Contact implements Entity {
    #values: Record<string, string | undefined> = {};
    #id?: EntityId;

    @accessor({ type: 'id', label: 'ID' })
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor({ type: 'string', label: 'Name' })
    get name() {
      return this.#values['name'];
    }
    set name(value) {
      this.#values['name'] = value;
    }

    @accessor({ type: 'string', label: 'Email', card: 'subtitle' })
    get email() {
      return this.#values['email'];
    }
    set email(value) {
      this.#values['email'] = value;
    }

    @accessor({ type: 'enum', label: 'Tier', enumValues: ['gold'] })
    get tier() {
      return this.#values['tier'];
    }
    set tier(value) {
      this.#values['tier'] = value;
    }

    @accessor({ type: 'string', label: 'City' })
    get city() {
      return this.#values['city'];
    }
    set city(value) {
      this.#values['city'] = value;
    }

    @accessor({ type: 'string', label: 'Phone' })
    get phone() {
      return this.#values['phone'];
    }
    set phone(value) {
      this.#values['phone'] = value;
    }

    @accessor({ type: 'string', label: 'Fax' })
    get fax() {
      return this.#values['fax'];
    }
    set fax(value) {
      this.#values['fax'] = value;
    }

    @accessor({ type: 'string', label: 'Zone' })
    get zone() {
      return this.#values['zone'];
    }
    set zone(value) {
      this.#values['zone'] = value;
    }

    @accessor({ type: 'string', label: 'Note', card: 'meta' })
    get note() {
      return this.#values['note'];
    }
    set note(value) {
      this.#values['note'] = value;
    }
  }

  it('reads a subtitle, the first enum as a badge, and at most three undeclared meta lines', () => {
    const contact = new Contact();
    contact.id = 'c-1';
    Object.assign(contact, {
      name: 'Ada',
      email: 'ada@example.com',
      tier: 'gold',
      city: 'Guatemala',
      phone: '555',
      fax: '556',
      zone: '10',
      note: 'VIP',
    });
    render(
      <EntityTable<Contact>
        {...baseProps}
        entityConstructor={Contact}
        items={[contact]}
        totalItems={1}
      />,
    );

    const card = screen.getByRole('article', { name: 'Ada' });
    expect(card).toHaveTextContent('ada@example.com');
    expect(within(card).getByText('gold')).toBeInTheDocument();
    const terms = within(card)
      .getAllByRole('term')
      .map(term => term.textContent);
    expect(terms).toEqual(['City', 'Phone', 'Fax', 'Note']);
  });
});
