import type { CommandPage } from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { Button } from '../../atoms/button/button.js';
import { CommandPalette } from './command-palette.js';

const LABELS = {
  title: 'Buscar o ejecutar',
  empty: 'Sin resultados',
  loading: 'Buscando…',
  more: (remaining: number) => `${remaining} más`,
  back: 'Volver',
};

const ROOT: CommandPage = {
  id: 'root',
  placeholder: 'Escribe para buscar…',
  sources: [
    {
      key: 'commands',
      groups: [
        {
          key: 'commands',
          label: 'Comandos',
          isLoading: false,
          options: [
            { id: 'new-product', label: 'Nuevo producto', href: '#new' },
            { id: 'open-orders', label: 'Ver pedidos', href: '#orders' },
          ],
        },
      ],
    },
    {
      key: 'records',
      groups: [
        {
          key: 'products',
          label: 'Productos',
          isLoading: false,
          total: 12,
          options: [
            {
              id: 'w-1',
              label: 'Sprocket',
              sublabel: '1,200 en stock',
              href: '#w-1',
            },
            {
              id: 'w-2',
              label: 'Flange',
              sublabel: '87 en stock',
              href: '#w-2',
            },
          ],
        },
      ],
    },
  ],
};

function Demo() {
  const [open, setOpen] = useState(true);
  const [stack, setStack] = useState<readonly string[]>([]);
  const [term, setTerm] = useState('');
  return (
    <>
      <Button onClick={() => setOpen(true)}>Search</Button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        pages={[ROOT]}
        stack={stack}
        onStackChange={setStack}
        term={term}
        onTermChange={setTerm}
        onSelect={() => setOpen(false)}
        labels={LABELS}
      />
    </>
  );
}

const meta: Meta = {
  title: 'Organisms/CommandPalette',
  component: CommandPalette,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await page.findByRole('dialog', { name: LABELS.title }),
    ).toBeVisible();
  },
};
