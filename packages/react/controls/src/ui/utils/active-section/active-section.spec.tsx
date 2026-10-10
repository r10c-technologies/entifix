import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FakeObserver,
  stubIntersectionObserver,
} from '../../spec-support/intersection-observer.js';
import { ActiveSection } from './active-section.js';

let made: FakeObserver[];

beforeEach(() => {
  made = stubIntersectionObserver();
});

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  return render(
    <>
      <a href="/en/#about" data-section="about">
        About
      </a>
      <a href="/en/#projects" data-section="projects">
        Projects
      </a>
      <section id="about" />
      <section id="projects" />
      <ActiveSection sections={['about', 'projects', 'contact']} />
    </>,
  );
}

/** Reports sections entering or leaving the band. */
function report(entries: Record<string, boolean>) {
  const observer = made.at(-1) as FakeObserver;
  act(() =>
    observer.callback(
      Object.entries(entries).map(([id, isIntersecting]) => ({
        target: document.getElementById(id) as Element,
        isIntersecting,
      })) as IntersectionObserverEntry[],
      observer as unknown as IntersectionObserver,
    ),
  );
}

const current = (text: string, container: HTMLElement) =>
  [...container.querySelectorAll('a')]
    .find(anchor => anchor.textContent === text)
    ?.getAttribute('aria-current');

describe('the active section', () => {
  it('observes the sections that exist, and skips one that does not', () => {
    renderPage();
    expect(made.at(-1)?.observed.map(element => element.id)).toEqual([
      'about',
      'projects',
    ]);
  });

  it('marks the first section in view, and moves as they scroll', () => {
    const { container } = renderPage();
    report({ about: true, projects: true });
    expect(current('About', container)).toBe('location');
    expect(current('Projects', container)).toBeNull();

    report({ about: false });
    expect(current('About', container)).toBeNull();
    expect(current('Projects', container)).toBe('location');

    report({ projects: false });
    expect(current('Projects', container)).toBeNull();
  });

  it('stops observing once unmounted', () => {
    renderPage().unmount();
    expect(made.at(-1)?.disconnect).toHaveBeenCalled();
  });
});
