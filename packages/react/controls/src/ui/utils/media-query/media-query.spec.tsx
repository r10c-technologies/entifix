import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installMatchMedia,
  setViewportWidth,
} from '../../spec-support/match-media.js';
import { useMediaQuery } from './media-query.js';

// jsdom has no `matchMedia`: a stand-in at a desk's width.
beforeEach(() => installMatchMedia());

function Probe({ query, server }: { query: string; server: boolean }) {
  return <p>{String(useMediaQuery(query, server))}</p>;
}

describe('whether a media query matches', () => {
  it('is the server’s value when rendered on the server', () => {
    expect(
      renderToString(<Probe query="(width >= 64rem)" server={false} />),
    ).toContain('false');
  });

  it('is the browser’s answer, kept in step as the window changes', () => {
    render(<Probe query="(width >= 64rem)" server={false} />);
    expect(screen.getByRole('paragraph').textContent).toBe('true');
    act(() => setViewportWidth(390));
    expect(screen.getByRole('paragraph').textContent).toBe('false');
    act(() => setViewportWidth(1440));
    expect(screen.getByRole('paragraph').textContent).toBe('true');
  });

  it('stops listening once gone', () => {
    const removed = vi.fn();
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: removed,
    }));
    const { unmount } = render(
      <Probe query="(width < 40rem)" server={false} />,
    );
    unmount();
    expect(removed).toHaveBeenCalledWith('change', expect.any(Function));
    vi.unstubAllGlobals();
  });
});
