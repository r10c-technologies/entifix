import { renderToStaticMarkup } from 'react-dom/server';

import { DocsHead } from './head.js';
import { SCHEME_ATTRIBUTE, schemeOf, schemeScript } from './scheme.js';

describe('the scheme', () => {
  it('is dark for a palette declared dark, light otherwise', () => {
    expect(schemeOf('midnight', ['midnight'])).toBe('dark');
    expect(schemeOf('aurora', ['midnight'])).toBe('light');
    expect(schemeOf(undefined, ['midnight'])).toBe('light');
  });

  // The script is a string the browser runs; running it is the only test of it.
  const run = (script: string) =>
    // eslint-disable-next-line no-new-func -- see above
    new Function(script)();

  it('is set by the first-paint script from the painted palette', () => {
    const root = document.documentElement;
    root.dataset.theme = 'midnight';
    run(schemeScript(['midnight']));
    expect(root.getAttribute(SCHEME_ATTRIBUTE)).toBe('dark');
    root.dataset.theme = 'aurora';
    run(schemeScript(['midnight']));
    expect(root.getAttribute(SCHEME_ATTRIBUTE)).toBe('light');
  });
});

describe('DocsHead', () => {
  const themes = [
    { id: 'aurora', label: 'A' },
    { id: 'midnight', label: 'M' },
  ];

  it('renders the theme script, then the scheme script', () => {
    const html = renderToStaticMarkup(
      <DocsHead themes={themes} darkPalettes={['midnight']} />,
    );
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html).toContain('["midnight"]');
  });

  it('passes a default palette and a nonce through', () => {
    const html = renderToStaticMarkup(
      <DocsHead
        themes={themes}
        defaultTheme="midnight"
        darkPalettes={[]}
        nonce="n0"
      />,
    );
    expect(html.match(/nonce="n0"/g)).toHaveLength(2);
    expect(html).toContain('theme = "midnight"');
  });
});
