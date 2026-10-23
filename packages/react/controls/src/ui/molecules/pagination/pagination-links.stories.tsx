import type { Meta, StoryObj } from '@storybook/react-vite';

import { PaginationLinks } from './pagination-links.js';

const LABELS: Record<string, string> = {
  'pagination.label': 'Pagination',
  'pagination.previous': 'Previous',
  'pagination.next': 'Next',
};

const meta = {
  title: 'Molecules/PaginationLinks',
  component: PaginationLinks,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    currentPage: 3,
    pageSize: 12,
    totalItems: 240,
    hrefFor: (page: number) => (page === 1 ? '?' : `?page=${page}`),
    t: (key, params) =>
      key === 'pagination.summary'
        ? `Page ${String(params?.['current'])} of ${String(params?.['total'])} · ${String(params?.['items'])} items`
        : (LABELS[key] ?? key),
  },
} satisfies Meta<typeof PaginationLinks>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const FirstPage: Story = { args: { currentPage: 1 } };
export const LastPage: Story = { args: { currentPage: 20 } };
export const SinglePage: Story = { args: { currentPage: 1, totalItems: 5 } };
export const WideWindow: Story = { args: { currentPage: 10, radius: 2 } };
