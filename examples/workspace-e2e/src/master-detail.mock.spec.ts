import { expect, failOnPageErrors, test } from './support';

/**
 * A record and the rows it owns, saved in one write.
 *
 * `lines` is a composition, so the generated form renders it as a grid under
 * the record rather than as a picker, and Save carries both.
 *
 * The repository lives in the page, so this journey also proves that nothing
 * between save and reopen loads a document: a load would start it over from the
 * seed and the new row would be gone.
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

  // Reopened from the list row, which opens the record's tab in place.
  await page
    .getByRole('row')
    .filter({ hasText: 'INV-0002-A' })
    .getByRole('link', { name: 'Abrir' })
    .click();
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
