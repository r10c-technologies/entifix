import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installMatchMedia,
  setViewportWidth,
} from '../../spec-support/match-media.js';
import { FoldScript } from './fold-script.js';

// jsdom has no `matchMedia`: a stand-in at a desk's width.
beforeEach(() => installMatchMedia());

afterEach(() => vi.unstubAllGlobals());

/** Renders the disclosures and the script, then runs it as a browser would. */
function run(folds: Parameters<typeof FoldScript>[0]['folds']) {
  const { container } = render(
    <>
      <details className="legend" open />
      <details className="quadrant" open />
      <details className="quadrant" open />
      <FoldScript folds={folds} />
    </>,
  );
  const script = container.querySelector('script') as HTMLScriptElement;
  new Function(script.innerHTML)();
  return {
    script,
    open: (selector: string) =>
      [...container.querySelectorAll<HTMLDetailsElement>(selector)].map(
        details => details.open,
      ),
  };
}

describe('the script that folds disclosures before paint', () => {
  const folds = [
    { query: '(width >= 64rem)', selector: '.legend' },
    { query: '(width < 64rem)', selector: '.quadrant' },
  ];

  it('closes what its query matches on a wide screen, and leaves the rest', () => {
    const { open } = run(folds);
    expect(open('.legend')).toEqual([false]);
    expect(open('.quadrant')).toEqual([true, true]);
  });

  it('closes the others on a narrow one', () => {
    setViewportWidth(390);
    const { open } = run(folds);
    expect(open('.legend')).toEqual([true]);
    expect(open('.quadrant')).toEqual([false, false]);
  });

  it('escapes a selector that could close the script element', () => {
    const { script } = run([
      { query: '(width >= 1px)', selector: '</script>' },
    ]);
    expect(script.innerHTML).not.toContain('</script>');
    expect(script.innerHTML).toContain('\\u003c/script>');
  });

  it('leaves everything open where the browser cannot answer', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('no media queries');
    });
    const { open } = run(folds);
    expect(open('details')).toEqual([true, true, true]);
  });
});
