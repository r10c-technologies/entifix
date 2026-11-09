import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu } from './menu.js';

function Fixture({ onPick }: { onPick?: () => void }) {
  return (
    <Menu>
      <Menu.Trigger>Account</Menu.Trigger>
      <Menu.Items>
        <Menu.Link href="https://auth.example/es/account">Settings</Menu.Link>
        <Menu.Item onClick={onPick}>Profile</Menu.Item>
        <Menu.Item disabled>Billing</Menu.Item>
      </Menu.Items>
    </Menu>
  );
}

describe('Menu', () => {
  it('keeps items hidden until the trigger is opened', () => {
    render(<Fixture />);

    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.queryByText('Profile')).not.toBeInTheDocument();
  });

  it('reveals items and fires the picked item', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<Fixture onPick={onPick} />);

    await user.click(screen.getByText('Account'));
    await user.click(screen.getByText('Profile'));

    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('renders a navigating entry as an anchor', async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    await user.click(screen.getByText('Account'));

    // An anchor rather than a button: the account menu's entries point at a
    // different origin, where a client-side transition is not an option.
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      'https://auth.example/es/account',
    );
  });

  it('renders a disabled item that cannot be picked', async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    await user.click(screen.getByText('Account'));
    const billing = screen.getByText('Billing');

    expect(billing).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Menu radio groups', () => {
  it('names the group and marks the option in effect', async () => {
    const choose = vi.fn();
    render(
      <Menu>
        <Menu.Trigger>Cuenta</Menu.Trigger>
        <Menu.Items>
          <Menu.Group label="Tema">
            <Menu.Radio checked onClick={() => choose('aurora')}>
              Aurora
            </Menu.Radio>
            <Menu.Radio checked={false} onClick={() => choose('midnight')}>
              Medianoche
            </Menu.Radio>
          </Menu.Group>
        </Menu.Items>
      </Menu>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cuenta' }));

    const group = screen.getByRole('group', { name: 'Tema' });
    expect(
      within(group).getByRole('menuitemradio', { name: 'Aurora' }),
    ).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(
      within(group).getByRole('menuitemradio', { name: 'Medianoche' }),
    );
    expect(choose).toHaveBeenCalledWith('midnight');
  });
});
