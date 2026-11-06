import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { expect, within } from 'storybook/test';

import { ToastProvider, ToastRegion, useToasts } from './toast-region.js';

/** Raises two failures on mount, as a page whose writes were refused would. */
function Failures() {
  // `show` is stable across renders, so this runs once.
  const show = useToasts()?.show;
  useEffect(() => {
    show?.({ tone: 'failure', failure: new Error('The network went away.') });
    show?.({
      tone: 'failure',
      failure: new Error('The price could not be saved.'),
    });
  }, [show]);
  return <p>Saving the product…</p>;
}

/** One toast of every tone that is not a failure. */
function Outcomes() {
  const show = useToasts()?.show;
  useEffect(() => {
    show?.({ tone: 'success', message: 'Invoice saved.' });
    show?.({
      tone: 'undo',
      message: 'Invoice archived.',
      action: { label: 'Undo', onAction: () => undefined },
    });
    show?.({ tone: 'info', message: 'Prices refresh every hour.' });
  }, [show]);
  return <p>Invoices</p>;
}

const meta: Meta = {
  title: 'Molecules/ToastRegion',
  component: ToastRegion,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const Failed: Story = {
  render: () => (
    <ToastProvider>
      <Failures />
      <ToastRegion />
    </ToastProvider>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findAllByRole('alert')).toHaveLength(2);
  },
};

export const Outcome: Story = {
  render: () => (
    <ToastProvider>
      <Outcomes />
      <ToastRegion />
    </ToastProvider>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findAllByRole('status')).toHaveLength(3);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  },
};

/**
 * An empty region over a link in the corner it would cover: it measures 0×0,
 * and the point over its corner reaches the link beneath (WCAG 2.4.11).
 */
export const EmptyOverContent: Story = {
  render: () => (
    <ToastProvider>
      <a
        href="#corner"
        className="bottom-0 right-0 fixed p-s focus-ring"
        data-testid="corner-link"
      >
        Corner link
      </a>
      <ToastRegion />
    </ToastProvider>
  ),
  play: async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument;
    const page = within(document.body);
    const box = page.getByTestId('toast-region').getBoundingClientRect();
    await expect([box.width, box.height]).toEqual([0, 0]);
    const link = page.getByTestId('corner-link');
    const corner = link.getBoundingClientRect();
    await expect(
      document.elementFromPoint(corner.right - 4, corner.bottom - 4),
    ).toBe(link);
  },
};
