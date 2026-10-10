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
    const group = screen.getByRole('radiogroup');
    fireEvent.click(screen.getByRole('radio', { name: 'Both' }));
    expect(checked()).toEqual(['Both']);
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checked()).toEqual(['List']);
    expect(document.activeElement?.textContent).toBe('List');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(checked()).toEqual(['Both']);
    fireEvent.keyDown(group, { key: 'ArrowUp' });
    expect(checked()).toEqual(['Chart']);
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(checked()).toEqual(['Both']);
    fireEvent.keyDown(group, { key: 'Home' });
    expect(checked()).toEqual(['List']);
    fireEvent.keyDown(group, { key: 'End' });
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
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
    expect(checked()).toEqual(['List']);
  });
});
