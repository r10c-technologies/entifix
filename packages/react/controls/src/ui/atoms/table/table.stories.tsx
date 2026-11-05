import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from './table.js';

const meta: Meta = {
  title: 'Atoms/Table',
  component: Table,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

const ROWS = [
  ['Sprocket', 1200],
  ['Flange', 87],
  ['Grommet', 4310],
] as const;

/** The table primitives with nothing entity-shaped on top. */
export const Default: Story = {
  render: () => (
    <Table>
      <caption className="sr-only">Stock by item</caption>
      <TableHead>
        <TableRow>
          <TableHeaderCell scope="col">Item</TableHeaderCell>
          <TableHeaderCell scope="col" align="end">
            Units in stock
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {ROWS.map(([name, stock]) => (
          <TableRow key={name}>
            <TableCell>{name}</TableCell>
            <TableCell align="end">{stock}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};
