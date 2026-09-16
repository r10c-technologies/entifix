import { expect, failOnPageErrors, test } from './support';

/**
 * The palette owns no index: commands are the host's, verbs come from entity
 * metadata, and records from the app's own `/api/search`.
 */
const openPalette = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Buscar o ejecutar' }).click();
  return page.getByRole('combobox', { name: 'Buscar o ejecutar' });
};

test('runs a host command', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es');
  const input = await openPalette(page);
  await input.fill('Nueva factura');
  await page.getByRole('option', { name: 'Nueva factura' }).first().click();
  await expect(page).toHaveURL(/\/wizards\/new-invoice/);
});

test('runs an unbound verb declared on an entity', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es');
  const input = await openPalette(page);
  await input.fill('Restablecer');
  await page
    .getByRole('option', { name: 'Restablecer los datos de ejemplo' })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('finds seeded records through the search route', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es');
  const input = await openPalette(page);
  await input.fill('#ada');
  await expect(
    page.getByRole('option', { name: /Ada Lovelace/ }),
  ).toBeVisible();
});
