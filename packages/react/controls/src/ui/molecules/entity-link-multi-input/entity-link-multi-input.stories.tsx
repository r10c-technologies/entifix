import {
  accessor,
  type Entity,
  entity,
  type EntityFieldDescriptor,
  type EntityId,
  type EntityLinkSource,
} from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import {
  type ReferenceLabelLookup,
  ReferenceLabelsProvider,
} from '../../utils/reference-labels.js';
import { EntityLinkMultiInput } from './entity-link-multi-input.js';

@entity({ domain: 'story', key: 'phone' })
class StoryPhone implements Entity {
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

const PHONES = [
  new StoryPhone('p-1', 'Galaxy A15'),
  new StoryPhone('p-2', 'Moto G24'),
  new StoryPhone('p-3', 'Redmi 13C'),
];

const descriptor: EntityFieldDescriptor = {
  name: 'fits',
  key: 'fits',
  label: 'Fits',
  type: 'scalarCollection',
  sortable: false,
  filterable: true,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
  resetOnClone: false,
  references: { entity: 'story:phone' },
};

/** Names every phone above; an id it does not know reads as not found. */
const lookup: ReferenceLabelLookup = {
  label: (_entity, id) => {
    const found = PHONES.find(phone => phone.id === id);
    return found === undefined
      ? { status: 'notFound' }
      : { status: 'named', label: found.name ?? id };
  },
};

function Demo({
  initial = '',
  disabled = false,
}: {
  initial?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [term, setTerm] = useState('');
  const [isOpen, setOpen] = useState(false);
  const matches = PHONES.filter(phone =>
    (phone.name ?? '').toLowerCase().includes(term.toLowerCase()),
  );
  const source: EntityLinkSource<StoryPhone> = {
    entityConstructor: StoryPhone,
    labelOf: phone => phone.name ?? String(phone.id),
    selected: { isLoading: false },
    quick: { term, setTerm, options: matches, isLoading: false },
    browse: {
      items: PHONES,
      totalItems: PHONES.length,
      currentPage: 1,
      pageSize: 10,
      isLoading: false,
      onPageChange: () => undefined,
      onPageSizeChange: () => undefined,
      onFilteringChange: () => undefined,
      onSortingChange: () => undefined,
      isOpen,
      open: () => setOpen(true),
      close: () => setOpen(false),
    },
  };
  return (
    <ReferenceLabelsProvider lookup={lookup}>
      <div className="max-w-md">
        <EntityLinkMultiInput<StoryPhone>
          descriptor={descriptor}
          value={value}
          source={source}
          disabled={disabled}
          onChange={setValue}
        />
      </div>
    </ReferenceLabelsProvider>
  );
}

const meta = {
  title: 'Molecules/EntityLinkMultiInput',
  component: EntityLinkMultiInput,
  tags: ['autodocs'],
} satisfies Meta<typeof EntityLinkMultiInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing held yet: the list says so, and the search adds the first. */
export const Empty: Story = {
  render: () => <Demo />,
};

/** Each held record by name, each with its own remove button. */
export const Holding: Story = {
  render: () => <Demo initial="p-1,p-3" />,
};

/** An id no record answers still shows, and can still be removed. */
export const Unknown: Story = {
  render: () => <Demo initial="p-1,gone-0a1b2c3d" />,
};

/** Read-only: the names stay, the buttons go. */
export const Disabled: Story = {
  render: () => <Demo initial="p-1,p-2" disabled />,
};

/** Added by keyboard, removed by keyboard; focus never leaves the field. */
export const Keyboard: Story = {
  render: () => <Demo initial="p-1" />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole('combobox'));
    await userEvent.keyboard('moto');
    await page.findByRole('option', { name: 'Moto G24' });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    const list = page.getByRole('list', { name: 'Fits' });
    await expect(list).toHaveTextContent('Moto G24');
    await userEvent.click(page.getByRole('button', { name: /Galaxy A15/ }));
    await expect(list).not.toHaveTextContent('Galaxy A15');
  },
};
