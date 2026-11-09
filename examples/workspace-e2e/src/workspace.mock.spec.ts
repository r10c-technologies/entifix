import { expectAccessible } from './a11y';
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
  await expectAccessible(page, 'customer-list-tab');

  await page.getByRole('button', { name: 'Opciones de Facturas' }).click();
  await page
    .getByRole('menuitem', { name: 'Abrir en el espacio de trabajo' })
    .click();

  await expect(page).toHaveURL(/tab=master%3Ainvoice|tab=master:invoice/);
  await expect(page.getByRole('tab', { name: /Facturas/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('tab', { name: /Clientes/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Facturas/ })).toBeVisible();
});

/**
 * Live updates that stop say so (ADR 0028): the top bar shows them paused
 * with Reconnect, and the indicator clears once the stream is back.
 */
test('a dropped stream shows live updates paused until it reconnects', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/workspace');
  const paused = page.getByTestId('live-updates-paused');
  await expect(paused).toHaveCount(0);

  await page.evaluate('window.examplePush.drop("reconnecting")');
  await expect(paused).toHaveText(/Actualizaciones en vivo en pausa/);

  await paused.getByRole('button', { name: 'Reconectar' }).click();
  await expect(paused).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'reanudadas' }),
  ).toHaveCount(1);
});
