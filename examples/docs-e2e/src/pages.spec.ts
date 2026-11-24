import {
  expectNoNewA11yViolations,
  walkKeyboard,
} from '@entifix/testing-e2e/a11y';

import {
  BASE,
  BASELINE,
  contrastOf,
  expect,
  openIn,
  PAGES,
  test,
  THEMES,
  WIDTHS,
} from './support';

/**
 * The screen gate over the docs shell (entifix ADR 0031 §4, ADR 0024): every
 * page × palette × width passes axe against WCAG 2.2 AA with `target-size`, and
 * the keyboard walk — skip link first, a visible indicator on every stop, none
 * hidden under the sticky header (2.4.11).
 */
for (const theme of THEMES) {
  for (const viewport of WIDTHS) {
    for (const path of PAGES) {
      test(`${path} in ${theme} at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openIn(page, path, theme);
        await expectNoNewA11yViolations(page, {
          screen: `docs ${path} ${theme} ${viewport.name}`,
          baselinePath: BASELINE,
        });
        await walkKeyboard(page, { mainIndexMax: 40 });
      });
    }
  }
}

for (const theme of THEMES) {
  test(`the mobile sidebar in ${theme}`, async ({ page }) => {
    await page.setViewportSize(WIDTHS[1]);
    await openIn(page, '/guides/', theme);
    await page.getByRole('button', { name: 'Open the sidebar' }).click();
    await expect(page.locator('#nd-sidebar-mobile')).toBeVisible();
    await expectNoNewA11yViolations(page, {
      screen: `docs sidebar ${theme}`,
      baselinePath: BASELINE,
    });
  });

  test(`a control's boundary is 3:1 in ${theme} (1.4.11)`, async ({ page }) => {
    await openIn(page, '/guides/', theme);
    const trigger = page.locator('[data-search-full]').first();
    await expect(trigger).toBeVisible();
    const [border, background] = await trigger.evaluate(element => {
      const style = getComputedStyle(element);
      return [
        style.borderTopColor,
        getComputedStyle(element.closest('#nd-sidebar') ?? document.body)
          .backgroundColor,
      ];
    });
    expect(await contrastOf(page, border, background)).toBeGreaterThanOrEqual(
      3,
    );
  });

  test(`one focus indicator per control in ${theme}`, async ({ page }) => {
    await openIn(page, '/records/0031/', theme);
    // fumadocs draws a box-shadow ring on its buttons; the engine's outline is
    // the one indicator, so the ring must not be drawn beside it.
    const button = page.locator('#nd-sidebar button').first();
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return { outline: style.outlineStyle, shadow: style.boxShadow };
    });
    expect(focused.outline).toBe('solid');
    // Tailwind leaves its shadow layers declared; each must be transparent.
    expect(
      focused.shadow.replaceAll('rgba(0, 0, 0, 0) 0px 0px 0px 0px', ''),
    ).toMatch(/^[,\s]*$|^none$/);
  });
}

test('every control keeps an edge and every focus shows in forced colours', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openIn(page, '/records/0031/', 'aurora');
  await walkKeyboard(page, { mainIndexMax: 40 });
  const edge = await page
    .locator('[data-search-full]')
    .first()
    .evaluate(element => getComputedStyle(element).borderTopStyle);
  expect(edge).toBe('solid');
});

test('a citation links the record it names, and a record links its siblings', async ({
  page,
}) => {
  await openIn(page, '/guides/', 'aurora');
  await page.getByRole('link', { name: 'ADR 0031' }).first().click();
  await expect(page).toHaveURL(/\/docs\/records\/0031\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'carries the records',
  );
});

test('a stored palette is painted before the page hydrates', async ({
  page,
}) => {
  await page.context().addCookies([
    {
      name: 'entifix-theme',
      value: 'midnight',
      url: 'http://localhost:3210',
    },
  ]);
  const painted: string[] = [];
  await page.exposeFunction('reportTheme', (theme: string) =>
    painted.push(theme),
  );
  await page.addInitScript(() => {
    new MutationObserver(records => {
      for (const record of records) {
        if (record.attributeName === 'data-theme') {
          (
            window as unknown as { reportTheme: (t: string) => void }
          ).reportTheme(document.documentElement.dataset['theme'] ?? '');
        }
      }
    }).observe(document, { attributes: true, subtree: true });
  });
  await page.goto('/docs/guides/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'dark');
  expect(painted).not.toContain('aurora');
});

/**
 * One origin, two halves (ADR 0031 §3): the docs under `/docs`, the controls'
 * Storybook under `/ui`, and the bare origin sent to the docs.
 */
test('the origin serves the docs, the package reference and the Storybook', async ({
  page,
  request,
}) => {
  const root = await request.get('/', { maxRedirects: 0 });
  expect(root.status()).toBe(308);
  expect(root.headers()['location']).toBe('/docs/');

  const storybook = await request.get('/ui/');
  expect(storybook.status()).toBe(200);
  expect(await storybook.text()).toContain('storybook');

  await page.goto(`${BASE}/packages/`);
  await page
    .getByRole('main')
    .getByRole('link', { name: '@entifix/sql', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/packages\/sql\/$/);
  await expect(
    page.getByRole('heading', { name: 'Entry points' }),
  ).toBeVisible();
  await expect(page.getByText('@entifix/sql/transactions')).toBeVisible();
});
