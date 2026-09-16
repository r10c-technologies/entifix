import { expect, failOnPageErrors, test } from './support';

/** Theme and density are document attributes; the locale is the URL prefix. */
test('switches theme, density and language', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es');
  const html = page.locator('html');

  await page.getByRole('radio', { name: 'Atardecer' }).click();
  await expect(html).toHaveAttribute('data-theme', 'sunset');

  await page.getByRole('radio', { name: 'Cómoda' }).check();
  await expect(html).toHaveAttribute('data-density', 'comfortable');

  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(
    page.getByRole('heading', { name: 'A workspace with no backend' }),
  ).toBeVisible();
  await expect(html).toHaveAttribute('lang', 'en');
});
