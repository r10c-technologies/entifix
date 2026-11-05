import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SplitView, type SplitViewItem } from './split-view.js';

const ITEMS: SplitViewItem[] = ['one', 'two', 'three'].map(id => ({
  id,
  head: <span>{`Head ${id}`}</span>,
  detail: <p>{`Detail ${id}`}</p>,
  href: `/items/${id}/`,
}));

/** The view as a page holds it: the choice is state. */
function Chosen({ initial }: { initial?: string }) {
  const [selected, setSelected] = useState(initial);
  return (
    <SplitView
      label="Items"
      items={ITEMS}
      selected={selected}
      onSelect={setSelected}
      className="extra"
    />
  );
}

const trigger = (name: string) => screen.getByRole('link', { name });

/** The row a keypress lands on: the one in the tab order. */
const press = (key: string) =>
  fireEvent.keyDown(
    screen
      .getAllByRole('link')
      .find(link => link.tabIndex === 0) as HTMLElement,
    { key },
  );

describe('a split view', () => {
  it('lists every item as a link, and shows the chosen one’s detail', () => {
    const { container } = render(<Chosen initial="two" />);
    expect(screen.getByRole('list', { name: 'Items' })).toBeTruthy();
    expect(trigger('Head one').getAttribute('href')).toBe('/items/one/');
    expect(trigger('Head two').getAttribute('aria-current')).toBe('true');
    expect(trigger('Head two').tabIndex).toBe(0);
    expect(trigger('Head one').tabIndex).toBe(-1);
    expect(screen.getByText('Detail two')).toBeTruthy();
    expect(screen.queryByText('Detail one')).toBeNull();
    expect(
      container.querySelector('[data-slot="split-view"]')?.className,
    ).toContain('extra');
  });

  it('chooses nothing for an unknown id, and keeps the first row focusable', () => {
    render(<Chosen initial="gone" />);
    expect(screen.queryByText(/^Detail/)).toBeNull();
    expect(trigger('Head one').tabIndex).toBe(0);
  });

  it('chooses on a plain click, and leaves a new tab to the link', () => {
    render(<Chosen initial="one" />);
    fireEvent.click(trigger('Head three'));
    expect(screen.getByText('Detail three')).toBeTruthy();
    for (const modifier of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { button: 1 },
    ]) {
      fireEvent.click(trigger('Head one'), modifier);
      expect(screen.getByText('Detail three')).toBeTruthy();
    }
  });

  it('moves the choice and the focus with the arrows, Home and End', () => {
    render(<Chosen initial="one" />);
    press('ArrowDown');
    expect(screen.getByText('Detail two')).toBeTruthy();
    expect(document.activeElement).toBe(trigger('Head two'));
    press('End');
    press('ArrowDown');
    expect(screen.getByText('Detail three')).toBeTruthy();
    press('Home');
    press('ArrowUp');
    expect(screen.getByText('Detail one')).toBeTruthy();
  });

  it('ignores other keys', () => {
    const onSelect = vi.fn();
    render(
      <SplitView
        label="Items"
        items={ITEMS}
        selected={undefined}
        onSelect={onSelect}
      />,
    );
    press('Enter');
    expect(onSelect).not.toHaveBeenCalled();
    press('ArrowDown');
    expect(onSelect).toHaveBeenCalledWith('two');
  });
});
