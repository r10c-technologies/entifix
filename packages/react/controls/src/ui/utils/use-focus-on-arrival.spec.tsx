import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  resetArrivalForTesting,
  useFocusOnArrival,
} from './use-focus-on-arrival.js';

function Region() {
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  return (
    <h1 ref={heading} tabIndex={-1}>
      Clientes
    </h1>
  );
}

beforeEach(() => {
  resetArrivalForTesting();
  (document.activeElement as HTMLElement | null)?.blur();
});

describe('useFocusOnArrival', () => {
  it('leaves the page the reader loaded alone', () => {
    render(<Region />);

    expect(document.body).toHaveFocus();
  });

  it('takes focus that fell to the body after the reader acted', () => {
    fireEvent.keyDown(document);
    render(<Region />);

    expect(screen.getByRole('heading')).toHaveFocus();
  });

  it('leaves focus where the reader put it', () => {
    fireEvent.pointerDown(document);
    render(<button type="button">Tab</button>);
    screen.getByRole('button', { name: 'Tab' }).focus();
    render(<Region />);

    expect(screen.getByRole('button', { name: 'Tab' })).toHaveFocus();
  });
});
