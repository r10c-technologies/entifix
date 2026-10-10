import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './switch.js';

describe('a switch', () => {
  it('is a checkbox announced as a switch, named by its text', () => {
    const onChange = vi.fn();
    render(
      <Switch checked={false} onChange={onChange}>
        Jest
      </Switch>,
    );
    const control = screen.getByRole('switch', { name: 'Jest' });
    expect(control.getAttribute('type')).toBe('checkbox');
    expect((control as HTMLInputElement).checked).toBe(false);
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('takes the page’s own label class instead of its own', () => {
    const { container } = render(
      <Switch className="mine" defaultChecked>
        Education
      </Switch>,
    );
    const label = container.querySelector('[data-slot="switch"]');
    expect(label?.className).toBe('mine');
    expect(
      (screen.getByRole('switch', { name: 'Education' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
