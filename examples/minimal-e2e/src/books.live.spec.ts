import { expect, test } from '@playwright/test';

/**
 * One entity through every layer: the generated screens, the same-origin proxy,
 * the service's guarded routes, the SQL adapter and a Postgres table.
 *
 * The title is unique per run, because the database outlives it.
 */
test('creates, edits and deletes a book through the whole stack', async ({
  page,
}) => {
  const title = `Solaris ${Date.now()}`;

  await page.goto('/es/books');
  await page.getByRole('link', { name: 'Nuevo' }).click();
  await expect(page.getByText('Nuevo libro')).toBeVisible();

  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Autor').fill('Lem');
  await page.getByLabel('Año').fill('1961');
  // A create seeds no values, so a required enum is chosen, not defaulted.
  await page.getByLabel('Estado').selectOption('available');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page).toHaveURL(/\/es\/books$/);
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toBeVisible();

  await row.getByRole('link', { name: 'Abrir' }).click();
  await expect(page.getByLabel('Título')).toHaveValue(title);
  await page.getByLabel('Estado').selectOption('lent');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page).toHaveURL(/\/es\/books$/);
  await expect(
    page.getByRole('row').filter({ hasText: title }).getByText('Prestado'),
  ).toBeVisible();

  await page
    .getByRole('row')
    .filter({ hasText: title })
    .getByRole('link', { name: 'Abrir' })
    .click();
  await page.getByRole('button', { name: 'Eliminar' }).click();

  await expect(page).toHaveURL(/\/es\/books$/);
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
});

test('the service refuses a request that carries no session', async ({
  request,
}) => {
  const response = await request.get('http://localhost:3301/api/book');
  expect(response.status()).toBe(401);
});
