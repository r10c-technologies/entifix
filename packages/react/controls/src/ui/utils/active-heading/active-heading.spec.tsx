import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveHeading } from './active-heading.js';

/** Where each heading's top is, from the window's top. */
let tops: Record<string, number>;

function box(left: number, width: number, top = 0) {
  return { left, width, top, right: left + width } as DOMRect;
}

beforeEach(() => {
  tops = { intro: 400, usage: 600 };
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
    frame(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return box(0, 0, tops[this.id] ?? 0);
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <>
      <ol data-testid="strip">
        <li>
          <a href="#intro" data-section="intro">
            Intro
          </a>
        </li>
        <li>
          <a href="#usage" data-section="usage">
            Usage
          </a>
        </li>
      </ol>
      <a href="#usage" data-section="usage">
        Usage, again
      </a>
      <h2 id="intro">Intro</h2>
      <h2 id="usage">Usage</h2>
      <ActiveHeading ids={['intro', 'usage', 'missing']} />
    </>,
  );
}

const marked = () =>
  [...document.querySelectorAll('a[aria-current="location"]')].map(
    anchor => anchor.textContent,
  );

function scrollTo(next: Record<string, number>) {
  tops = next;
  act(() => {
    fireEvent.scroll(window);
  });
}

describe('the heading being read', () => {
  it('is none above the first, then the last past a line 30% down', () => {
    renderPage();
    expect(marked()).toEqual([]);
    scrollTo({ intro: 100, usage: 500 });
    expect(marked()).toEqual(['Intro']);
    scrollTo({ intro: -400, usage: 200 });
    expect(marked()).toEqual(['Usage', 'Usage, again']);
    act(() => {
      fireEvent(window, new Event('resize'));
    });
    expect(marked()).toEqual(['Usage', 'Usage, again']);
  });

  it('is brought to the middle of a row that scrolls sideways', () => {
    renderPage();
    const strip = document.querySelector('ol') as HTMLOListElement;
    Object.defineProperty(strip, 'scrollWidth', { value: 600 });
    Object.defineProperty(strip, 'clientWidth', { value: 200 });
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(
      function (this: HTMLElement) {
        if (this === strip) return box(0, 200);
        if (this.dataset['section'] === 'usage') return box(300, 50);
        return box(0, 50, tops[this.id] ?? 0);
      },
    );
    scrollTo({ intro: -400, usage: 100 });
    // 300 − 0 − (200 − 50) / 2: the link's middle at the row's middle.
    expect(strip.scrollLeft).toBe(225);
    // The same heading again moves nothing.
    strip.scrollLeft = 0;
    scrollTo({ intro: -500, usage: 50 });
    expect(strip.scrollLeft).toBe(0);
  });

  it('stops listening once gone', () => {
    const { unmount } = renderPage();
    const removed = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(removed).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(removed).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
