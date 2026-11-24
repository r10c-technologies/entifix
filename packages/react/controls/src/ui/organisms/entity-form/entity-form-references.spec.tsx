import {
  accessor,
  type Entity,
  entity,
  type EntityDraft,
  type EntityId,
  type EntityLinkSource,
} from '@entifix/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EntityForm } from './entity-form.js';

@entity({ domain: 'catalog', key: 'phone' })
class Phone implements Entity {
  #id?: EntityId;
  #name?: string;
  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

@entity({ domain: 'catalog', key: 'case' })
class Case implements Entity {
  #id?: EntityId;
  #fits?: string[];
  #notes?: string[];
  @accessor({ type: 'id', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
  @accessor({
    type: 'scalarCollection',
    label: 'Fits',
    references: { entity: 'catalog:phone' },
  })
  get fits(): string[] | undefined {
    return this.#fits;
  }
  set fits(value: string[] | undefined) {
    this.#fits = value;
  }
  @accessor({ type: 'scalarCollection', label: 'Notes' })
  get notes(): string[] | undefined {
    return this.#notes;
  }
  set notes(value: string[] | undefined) {
    this.#notes = value;
  }
}

const phone = (id: string, name: string) => {
  const one = new Phone();
  one.id = id;
  one.name = name;
  return one;
};

const phones = (): EntityLinkSource<Phone> => {
  const options = [phone('p-1', 'Galaxy'), phone('p-2', 'Moto')];
  return {
    entityConstructor: Phone,
    labelOf: target => target.name ?? '',
    selected: { isLoading: false },
    quick: { term: '', setTerm: vi.fn(), options, isLoading: false },
    browse: {
      items: options,
      totalItems: options.length,
      currentPage: 1,
      pageSize: 10,
      isLoading: false,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      onFilteringChange: vi.fn(),
      onSortingChange: vi.fn(),
      isOpen: false,
      open: vi.fn(),
      close: vi.fn(),
    },
  };
};

function Harness({ onSubmit }: { onSubmit: (draft: EntityDraft) => void }) {
  const [values, setValues] = useState<EntityDraft>({ fits: 'p-1' });
  return (
    <EntityForm<Case>
      entityConstructor={Case}
      mode="edit"
      values={values}
      onFieldChange={(name, value) =>
        setValues(previous => ({ ...previous, [name]: value }))
      }
      linkSources={{ fits: phones() }}
      onSubmit={onSubmit}
    />
  );
}

describe('a list of references in the form', () => {
  // The draft carries a list as the comma string every scalarCollection uses,
  // so reconstruction and validation see the ids exactly as before.
  it('is edited by name and saved as the list of ids', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Ver sugerencias de Fits' }),
    );
    await userEvent.click(screen.getByRole('option', { name: 'Moto' }));
    await userEvent.click(screen.getByRole('button', { name: /^Quitar p-1$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ fits: 'p-2' }),
    );
  });

  it('refuses a source on a list that references nothing', () => {
    expect(() =>
      render(
        <EntityForm<Case>
          entityConstructor={Case}
          mode="edit"
          linkSources={{ notes: phones() }}
        />,
      ),
    ).toThrow(/scalarCollection.*references/);
  });
});
