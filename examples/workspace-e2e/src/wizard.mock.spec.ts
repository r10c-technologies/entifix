import { expect, failOnPageErrors, test } from './support';

/**
 * A guided create: the step graph is data, Back walks it, and finishing hands
 * the new record to its own tab.
 */
test('walks the steps, goes back without losing input, and opens the new invoice', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/workspace?tab=wizard:new-invoice');

  const next = page.getByRole('button', { name: 'Continuar' });
  await expect(next).toBeDisabled();
  await page
    .getByLabel('Cliente', { exact: true })
    .selectOption({ label: 'Grace Hopper' });
  await next.click();

  await page.getByLabel('Descripción').fill('Debugging');
  await page.getByLabel('Cantidad').fill('1');
  await page.getByLabel('Precio unitario').fill('42');
  await page.getByRole('button', { name: 'Agregar línea' }).click();
  await expect(page.getByText('1 × Debugging')).toBeVisible();
  await next.click();

  await expect(page.getByText('Grace Hopper')).toBeVisible();
  await page.getByRole('button', { name: 'Atrás' }).click();
  await expect(page.getByText('1 × Debugging')).toBeVisible();
  await next.click();

  await page.getByRole('button', { name: 'Finalizar' }).click();
  await expect(page.getByRole('tab', { name: /Factura #/ })).toBeVisible();
  await expect(page.getByLabel('Descripción')).toHaveValue('Debugging');
});
