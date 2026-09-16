import { EntityTablePage } from '@entifix/testing-e2e/playwright';

import { expect, failOnPageErrors, test } from './support';

/**
 * The generated table and form, on plain routes, over the in-memory repository.
 *
 * Navigation stays client-side after the first load: a `page.goto` reloads the
 * app, and a reload puts every saved record back to the seed.
 */
test('lists the seed, edits a record and shows the edit in the list', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/customers');

  const table = new EntityTablePage(page);
  await table.waitForRows();
  expect(await table.columnValues('Nombre')).toEqual(
    expect.arrayContaining(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']),
  );

  await table.rows
    .filter({ hasText: 'Alan Turing' })
    .getByRole('link', { name: 'Abrir' })
    .or(
      table.rows
        .filter({ hasText: 'Alan Turing' })
        .getByRole('button', { name: 'Abrir' }),
    )
    .click();

  const name = page.getByLabel('Nombre');
  await expect(name).toHaveValue('Alan Turing');
  await name.fill('Alan M. Turing');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page).toHaveURL(/\/es\/customers$/);
  await table.waitForRows();
  expect(await table.columnValues('Nombre')).toContain('Alan M. Turing');
});
