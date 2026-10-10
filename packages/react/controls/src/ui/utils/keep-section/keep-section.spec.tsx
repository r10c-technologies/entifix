import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { KeepSection } from './keep-section.js';

afterEach(() => {
  window.location.hash = '';
});

function renderNav() {
  const view = render(
    <>
      <a href="/en/#projects" data-section="projects">
        Projects
      </a>
      <a href="/es/" data-keep-section>
        Español
      </a>
      <a href="/en/cv/">CV</a>
      <KeepSection />
    </>,
  );
  // jsdom does not navigate; keep it from trying.
  view.container.addEventListener('click', event => event.preventDefault());
  return view;
}

const link = (name: string) =>
  [...document.querySelectorAll('a')].find(
    anchor => anchor.textContent === name,
  ) as HTMLAnchorElement;

describe('keeping the section across the language switch', () => {
  it('carries the section in view', () => {
    renderNav();
    link('Projects').setAttribute('aria-current', 'location');
    fireEvent.click(link('Español'));
    expect(link('Español').pathname).toBe('/es/');
    expect(link('Español').hash).toBe('#projects');
  });

  it("carries the page's fragment when no section is in view", () => {
    renderNav();
    window.location.hash = '#contact';
    fireEvent.click(link('Español'));
    expect(link('Español').hash).toBe('#contact');
  });

  it('leaves every other link, and a click on the page, alone', () => {
    renderNav();
    fireEvent.click(link('CV'));
    fireEvent.click(document);
    expect(link('CV').getAttribute('href')).toBe('/en/cv/');
    expect(link('Español').getAttribute('href')).toBe('/es/');
  });

  it('stops listening once unmounted', () => {
    const { unmount } = renderNav();
    const español = link('Español');
    const projects = link('Projects');
    unmount();
    document.body.append(español, projects);
    projects.setAttribute('aria-current', 'location');
    español.addEventListener('click', event => event.preventDefault());
    fireEvent.click(español);
    expect(español.getAttribute('href')).toBe('/es/');
    español.remove();
    projects.remove();
  });
});
