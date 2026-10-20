import type {
  EntityFieldDescriptor,
  EntityLocalizedDraft,
} from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { LocalizedFieldControl } from './localized-field-control.js';

const descriptor: EntityFieldDescriptor = {
  name: 'title',
  key: 'title',
  label: 'Title',
  type: 'localized',
  sortable: true,
  filterable: true,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
  resetOnClone: false,
};

const meta = {
  title: 'Atoms/LocalizedFieldControl',
  component: LocalizedFieldControl,
  tags: ['autodocs'],
  args: { descriptor, value: {}, onChange: () => undefined },
} satisfies Meta<typeof LocalizedFieldControl>;

export default meta;
type Story = StoryObj<typeof meta>;

function Editable({ initial }: { initial: EntityLocalizedDraft }) {
  const [value, setValue] = useState(initial);
  return (
    <LocalizedFieldControl
      descriptor={descriptor}
      value={value}
      onChange={setValue}
      id="title"
    />
  );
}

/** Every declared locale on screen; one still waits for its translation. */
export const PartlyTranslated: Story = {
  render: () => <Editable initial={{ es: 'Sopa del día' }} />,
};

export const ReadOnly: Story = {
  args: {
    descriptor: { ...descriptor, readonly: true },
    value: { es: 'Sopa del día', en: 'Soup of the day' },
  },
};
