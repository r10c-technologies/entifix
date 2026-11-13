import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  resetArrivalForTesting,
  useFocusOnArrival,
  useFocusOnLoss,
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

function Verbs({ verbs }: { verbs: readonly string[] }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnLoss(() => heading.current, verbs.join(' '));
  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        Envío
      </h1>
      {verbs.map(verb => (
        <button key={verb} type="button">
          {verb}
        </button>
      ))}
      <button type="button">Volver</button>
    </>
  );
}

describe('useFocusOnLoss', () => {
  it('takes focus to the target when the control holding it leaves', () => {
    const { rerender } = render(<Verbs verbs={['Despachar']} />);
    screen.getByRole('button', { name: 'Despachar' }).focus();

    rerender(<Verbs verbs={['Registrar entrega']} />);

    expect(screen.getByRole('heading')).toHaveFocus();
  });

  it('moves nothing when the verbs change under a reader who is elsewhere', () => {
    const { rerender } = render(<Verbs verbs={['Despachar']} />);
    const back = screen.getByRole('button', { name: 'Volver' });
    back.focus();
    back.blur();

    rerender(<Verbs verbs={['Registrar entrega']} />);

    expect(document.body).toHaveFocus();
  });

  it('leaves focus where it is when it is still on something', () => {
    const { rerender } = render(<Verbs verbs={['Despachar']} />);
    screen.getByRole('button', { name: 'Volver' }).focus();

    rerender(<Verbs verbs={['Registrar entrega']} />);

    expect(screen.getByRole('button', { name: 'Volver' })).toHaveFocus();
  });
});
