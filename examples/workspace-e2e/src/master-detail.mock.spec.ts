import { expect, failOnPageErrors, test } from './support';

/**
 * A record and the rows it owns, saved in one write.
 *
 * `lines` is a composition, so the generated form renders it as a grid under
 * the record rather than as a picker, and Save carries both.
 *
 * Driven through the workspace's tab strip: switching tabs is client-side, so
 * the in-memory repository still holds the save. The generated list's "open"
 * control is a plain link, and following it is a document load, which starts
 * the repository over from the seed.
 */
test('adds an owned row, saves, and finds it on the record again', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/workspace?tab=master:invoice:i-2');

  await expect(page.getByLabel('Número')).toHaveValue('INV-0002');
  await expect(page.getByLabel('Descripción')).toHaveCount(1);

  await page.getByLabel('Número').fill('INV-0002-A');
  await page.getByRole('button', { name: 'Añadir fila' }).click();
  await page.getByLabel('Descripción').last().fill('On-call rota');
  await page.getByLabel('Cantidad').last().fill('2');
  await page.getByLabel('Precio unitario').last().fill('150');
  await page.getByRole('button', { name: 'Guardar' }).click();

  // Saving returns to the list tab, which reads the repository again.
  await expect(page).toHaveURL(/tab=master%3Ainvoice$/);
  await expect(page.getByRole('cell', { name: 'INV-0002-A' })).toBeVisible();

  // Back to the record's own tab: both the scalar and the owned row landed.
  await page.getByRole('button', { name: 'Factura #i-2', exact: true }).click();
  await expect(page.getByLabel('Número')).toHaveValue('INV-0002-A');
  await expect(page.getByLabel('Descripción')).toHaveCount(2);
  await expect(page.getByLabel('Descripción').last()).toHaveValue(
    'On-call rota',
  );
});

test('runs a declared verb and shows the state it moved to', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/invoices/i-2');

  const status = page.getByLabel('Estado');
  await expect(status).toHaveValue('draft');
  await page.getByRole('button', { name: 'Emitir' }).click();
  await expect(status).toHaveValue('issued');
});
