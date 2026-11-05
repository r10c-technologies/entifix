import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl } from './segmented-control.js';

const OPTIONS = [
  { key: 'list', label: 'List' },
  { key: 'chart', label: 'Chart' },
  { key: 'both', label: 'Both' },
] as const;

type View = (typeof OPTIONS)[number]['key'];

function Controlled({ start }: { start: View }) {
  const [value, setValue] = useState<View>(start);
  return (
    <SegmentedControl
      label="View"
      options={OPTIONS}
      value={value}
      onChange={setValue}
      className="extra"
    />
  );
}

const checked = () =>
  screen
    .getAllByRole('radio')
    .filter(radio => radio.getAttribute('aria-checked') === 'true')
    .map(radio => radio.textContent);

/** The segment a keypress lands on: the one in the tab order. */
const press = (key: string) =>
  fireEvent.keyDown(
    screen
      .getAllByRole('radio')
      .find(radio => radio.tabIndex === 0) as HTMLElement,
    { key },
  );

describe('a segmented control', () => {
  it('is a radio group, one segment in the tab order', () => {
    render(<Controlled start="chart" />);
    const group = screen.getByRole('radiogroup', { name: 'View' });
    expect(group.className).toContain('extra');
    expect(checked()).toEqual(['Chart']);
    expect(
      screen.getAllByRole('radio').map(radio => radio.getAttribute('tabindex')),
    ).toEqual(['-1', '0', '-1']);
  });

  it('chooses by click, and by the arrows, Home and End, wrapping', () => {
    render(<Controlled start="list" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Both' }));
    expect(checked()).toEqual(['Both']);
    press('ArrowRight');
    expect(checked()).toEqual(['List']);
    expect(document.activeElement?.textContent).toBe('List');
    press('ArrowLeft');
    expect(checked()).toEqual(['Both']);
    press('ArrowUp');
    expect(checked()).toEqual(['Chart']);
    press('ArrowDown');
    expect(checked()).toEqual(['Both']);
    press('Home');
    expect(checked()).toEqual(['List']);
    press('End');
    expect(checked()).toEqual(['Both']);
  });

  it('ignores other keys, and falls back to the first for an unknown value', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="View"
        options={OPTIONS}
        value={'none' as View}
        onChange={onChange}
      />,
    );
    press('a');
    expect(onChange).not.toHaveBeenCalled();
    expect(checked()).toEqual(['List']);
  });
});
