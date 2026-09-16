import { expect, failOnPageErrors, test } from './support';

/**
 * Tabs are addressed, and the address is the state: the active tab is in the
 * URL, and the open set survives a reload.
 */
test('opens two tabs, tracks the active one in the URL, and restores both', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/workspace?tab=master:customer');
  await expect(page.getByRole('tab', { name: /Clientes/ })).toBeVisible();

  await page
    .getByRole('link', { name: 'Abrir Facturas en el espacio de trabajo' })
    .click();

  await expect(page).toHaveURL(/tab=master%3Ainvoice|tab=master:invoice/);
  await expect(page.getByRole('tab', { name: /Facturas/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('tab', { name: /Clientes/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Facturas/ })).toBeVisible();
});
