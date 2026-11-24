import {
  accessor,
  type Entity,
  entity,
  type EntityFieldDescriptor,
  type EntityId,
  type EntityLinkSource,
} from '@entifix/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  type ReferenceLabelLookup,
  ReferenceLabelsProvider,
} from '../../utils/reference-labels.js';
import { EntityLinkMultiInput, readIdList } from './entity-link-multi-input.js';

@entity({ domain: 'catalog', key: 'device-model' })
class DeviceModel implements Entity {
  #id?: EntityId;
  #name?: string;
  constructor(id?: EntityId, name?: string) {
    this.#id = id;
    this.#name = name;
  }
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

const MODELS = [
  new DeviceModel('m-1', 'Galaxy A15'),
  new DeviceModel('m-2', 'Moto G24'),
];

const descriptor: EntityFieldDescriptor = {
  name: 'fits',
  key: 'fits',
  label: 'Fits',
  type: 'scalarCollection',
  sortable: false,
  filterable: false,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
  resetOnClone: false,
  references: { entity: 'catalog:device-model' },
};

const source = (
  options: DeviceModel[] = MODELS,
): EntityLinkSource<DeviceModel> => ({
  entityConstructor: DeviceModel,
  labelOf: target => target.name ?? String(target.id),
  selected: { isLoading: false },
  quick: {
    term: '',
    setTerm: vi.fn(),
    options,
    isLoading: false,
  },
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
});

const NAMES: Record<string, string> = {
  'm-1': 'Galaxy A15',
  'm-2': 'Moto G24',
};
const lookup: ReferenceLabelLookup = {
  label: (_entity, id) =>
    NAMES[id] === undefined
      ? { status: 'notFound' }
      : { status: 'named', label: NAMES[id] },
};

const renderMulti = (
  value: string,
  props: { disabled?: boolean; options?: DeviceModel[] } = {},
) => {
  const onChange = vi.fn();
  render(
    <ReferenceLabelsProvider lookup={lookup}>
      <EntityLinkMultiInput<DeviceModel>
        descriptor={descriptor}
        value={value}
        source={source(props.options)}
        onChange={onChange}
        disabled={props.disabled}
      />
    </ReferenceLabelsProvider>,
  );
  return onChange;
};

describe('readIdList', () => {
  it('reads the comma list, blanks and spaces dropped', () => {
    expect(readIdList('')).toEqual([]);
    expect(readIdList(' a, ,b ')).toEqual(['a', 'b']);
  });
});

describe('EntityLinkMultiInput', () => {
  it('says nothing is held yet', () => {
    renderMulti('');
    expect(screen.getByText('Ninguno todavía')).toBeInTheDocument();
  });

  it('names every held id, in order, each with its own remove button', () => {
    renderMulti('m-2,m-1');
    const list = screen.getByRole('list', { name: 'Fits' });
    expect(list).toHaveTextContent(/Moto G24.*Galaxy A15/);
    expect(
      screen.getByRole('button', { name: 'Quitar Moto G24' }),
    ).toBeInTheDocument();
  });

  it('adds a picked target to the end of the list', async () => {
    const onChange = renderMulti('m-1');
    await userEvent.click(
      screen.getByRole('button', { name: 'Ver sugerencias de Fits' }),
    );
    await userEvent.click(screen.getByRole('option', { name: 'Moto G24' }));
    expect(onChange).toHaveBeenCalledWith('m-1,m-2');
  });

  it('does not add an id it already holds', async () => {
    const onChange = renderMulti('m-1');
    await userEvent.click(
      screen.getByRole('button', { name: 'Ver sugerencias de Fits' }),
    );
    await userEvent.click(screen.getByRole('option', { name: 'Galaxy A15' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not add a target that has no id yet', async () => {
    const onChange = renderMulti('', { options: [new DeviceModel()] });
    await userEvent.click(
      screen.getByRole('button', { name: 'Ver sugerencias de Fits' }),
    );
    await userEvent.click(screen.getByRole('option'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes one id and keeps the rest', async () => {
    const onChange = renderMulti('m-1,m-2');
    await userEvent.click(
      screen.getByRole('button', { name: 'Quitar Galaxy A15' }),
    );
    expect(onChange).toHaveBeenCalledWith('m-2');
  });

  it('still shows and removes an id no record answers', async () => {
    const onChange = renderMulti('gone-1234567890');
    const remove = screen.getByRole('button', { name: /^Quitar / });
    expect(remove).toBeInTheDocument();
    await userEvent.click(remove);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('offers neither adding nor removing when disabled', () => {
    renderMulti('m-1', { disabled: true });
    expect(screen.getByText('Galaxy A15')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows held ids as themselves when the member names no entity', () => {
    const { references: _dropped, ...bare } = descriptor;
    render(
      <EntityLinkMultiInput<DeviceModel>
        descriptor={bare}
        value="m-1"
        source={source()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('list', { name: 'Fits' })).toHaveTextContent('m-1');
  });

  it('adds from the browse dialog too', async () => {
    renderMulti('');
    await userEvent.click(
      screen.getByRole('button', { name: 'Examinar Fits' }),
    );
    // The dialog is closed in the fake source; opening is the source's job.
    expect(
      screen.getByRole('combobox', { name: 'Agregar a Fits' }),
    ).toBeVisible();
  });
});
