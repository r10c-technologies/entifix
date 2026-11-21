import { expectNoNewA11yViolations } from '@entifix/testing-e2e/a11y';

import { BASELINE, expect, openIn, test, THEMES } from './support';

/**
 * Search runs on the Pagefind index the build wrote beside the export, under
 * the site's base path (entifix #276).
 */
for (const theme of THEMES) {
  test(`search finds a record, and its dialog passes axe in ${theme}`, async ({
    page,
  }) => {
    await openIn(page, '/guides/', theme);
    await page.locator('[data-search-full]').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').fill('outbox');
    const first = dialog.getByRole('option').first();
    await expect(first).toBeVisible();
    await expectNoNewA11yViolations(page, {
      screen: `docs search ${theme}`,
      baselinePath: BASELINE,
    });

    // WCAG 2.5.3: the Close button's name starts with the word it shows.
    const close = dialog.getByRole('button', { name: /^Esc\b/ });
    await expect(close).toHaveText('Esc');

    await first.click();
    await expect(page).toHaveURL(/\/entifix\/records\/\d{4}\//);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
}

// Pagefind tolerates typos, so a made-up word still finds a near one; four
// of one letter is the query that matches nothing.
test('no result says so, and Escape closes the dialog', async ({ page }) => {
  await openIn(page, '/guides/', 'aurora');
  await page.locator('[data-search-full]').first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').fill('qqqq');
  await expect(dialog.getByText('No results')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
