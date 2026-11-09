import { EntityTablePage } from '@entifix/testing-e2e/playwright';

import { expectAccessible, expectNoNewViolations } from './a11y';
import { expect, failOnPageErrors, test } from './support';

/** Theme and density are document attributes; the locale is the URL prefix. */
test('switches theme, density and language', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es');
  const html = page.locator('html');
  await expectAccessible(page, 'home');

  await page.getByRole('radio', { name: 'Atardecer' }).click();
  await expect(html).toHaveAttribute('data-theme', 'sunset');
  await expectNoNewViolations(page, 'home-sunset');

  await page.getByRole('radio', { name: 'Cómoda' }).check();
  await expect(html).toHaveAttribute('data-density', 'comfortable');

  // A choice survives a reload: the provider writes only what is chosen, so
  // mounting again can never put the default back (entifix#187).
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'sunset');
  await expect(page.getByRole('radio', { name: 'Atardecer' })).toBeChecked();
  await expect(html).toHaveAttribute('data-density', 'comfortable');
  await expect(page.getByRole('radio', { name: 'Cómoda' })).toBeChecked();

  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(
    page.getByRole('heading', { name: 'A workspace with no backend' }),
  ).toBeVisible();
  await expect(html).toHaveAttribute('lang', 'en');
});

/**
 * The account menu's appearance choices are rendered with the page after a
 * reload: the server reads them, so nothing repaints once it has loaded
 * (ADR 0025).
 */
test('the account menu’s theme and density survive a reload with no repaint', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/customers');
  const html = page.locator('html');
  const account = page.getByRole('button', { name: 'Invitado' });

  await account.click();
  await page.getByRole('menuitemradio', { name: 'Medianoche' }).click();
  await account.click();
  await page.getByRole('menuitemradio', { name: 'Cómoda' }).click();
  await expect(html).toHaveAttribute('data-theme', 'midnight');
  await expect(html).toHaveAttribute('data-density', 'comfortable');

  // Every change to the two attributes after the document is parsed.
  await page.addInitScript(`
    window.appearanceChanges = [];
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(records => {
        for (const record of records)
          window.appearanceChanges.push(String(record.attributeName));
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-density'],
      });
    });
  `);
  await page.reload();
  await new EntityTablePage(page).waitForRows();

  await expect(html).toHaveAttribute('data-theme', 'midnight');
  await expect(html).toHaveAttribute('data-density', 'comfortable');
  expect(await page.evaluate('window.appearanceChanges')).toEqual([]);
});
