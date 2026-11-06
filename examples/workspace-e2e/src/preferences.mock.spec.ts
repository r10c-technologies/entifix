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
