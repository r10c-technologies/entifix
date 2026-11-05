import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  type EntityLinkSource,
} from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Button } from '../../atoms/button/button.js';
import { descriptor } from '../../story-support/descriptors.js';
import { EntityLinkPicker } from './entity-link-picker.js';

@entity({ key: 'story-picker-brand' })
class StoryBrand implements Entity {
  #id?: EntityId;
  #name?: string;

  constructor(id?: EntityId, name?: string) {
    this.#id = id;
    this.#name = name;
  }

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
}

const BRANDS = [
  new StoryBrand('b-1', 'Acme'),
  new StoryBrand('b-2', 'Globex'),
  new StoryBrand('b-3', 'Initech'),
];

const noop = () => undefined;

const SOURCE: EntityLinkSource<StoryBrand> = {
  entityConstructor: StoryBrand,
  labelOf: target => target.name ?? '',
  selected: { isLoading: false },
  quick: { term: '', setTerm: noop, options: BRANDS, isLoading: false },
  browse: {
    items: BRANDS,
    totalItems: BRANDS.length,
    currentPage: 1,
    pageSize: 10,
    isLoading: false,
    onPageChange: noop,
    onPageSizeChange: noop,
    onFilteringChange: noop,
    onSortingChange: noop,
    isOpen: true,
    open: noop,
    close: noop,
  },
};

const meta: Meta = {
  title: 'Molecules/EntityLinkPicker',
  component: EntityLinkPicker,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/** The browse dialog a link field opens, listing the targets to pick from. */
export const Open: Story = {
  render: () => (
    <>
      <Button>Choose a brand</Button>
      <EntityLinkPicker
        descriptor={descriptor('brand', 'Brand', 'link')}
        source={SOURCE}
        onSelect={noop}
      />
    </>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findByRole('dialog')).toBeVisible();
  },
};
