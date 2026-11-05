import { walkKeyboard } from '@entifix/testing-e2e/a11y';

import { expect, test } from './support';

/**
 * The keyboard walk over a sidebar that scrolls, as an adopting host's long
 * navigation does. Focusing each link scrolls the sidebar, so a stop's
 * position has to be read in the content it scrolls with: read in the
 * viewport, every link further down the scrolled list looked a row *above*
 * the one before it, and the walk refused a correct tab order.
 *
 * And a link the sticky header half covers is still visible (WCAG 2.4.11 only
 * fails a control that is entirely hidden), while one it covers completely is
 * reported.
 */
const page40 = (header: string) => `<!doctype html>
<html><body style="margin:0;font:16px sans-serif">
  <header style="position:sticky;top:0;height:${header};background:#fff;z-index:1">Shop</header>
  <aside style="height:200px;overflow:auto;width:200px">
    ${Array.from({ length: 40 }, (_, at) => `<a href="#l${at}" style="display:block;height:24px;outline-offset:-2px">Link ${at}</a>`).join('')}
  </aside>
  <main><a href="#main" style="display:block">Main</a></main>
  <style>a:focus{outline:2px solid #000}</style>
</body></html>`;

test('reads positions in the scrolled sidebar, not the viewport', async ({
  page,
}) => {
  await page.setContent(page40('24px'));
  await walkKeyboard(page, { skipLink: false, mainIndexMax: 41 });
});

test('still refuses a stop that is out of order in the content', async ({
  page,
}) => {
  await page.setContent(
    page40('24px').replace(
      '<main>',
      '<main style="display:flex;flex-direction:column-reverse"><a href="#x" style="display:block;margin-top:60px">Second</a>',
    ),
  );
  await expect(
    walkKeyboard(page, { skipLink: false, mainIndexMax: 42 }),
  ).rejects.toThrow(/more than a row above/);
});
