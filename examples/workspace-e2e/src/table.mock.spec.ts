import { EntityTablePage } from '@entifix/testing-e2e/playwright';

import { expect, failOnPageErrors, test } from './support';

/**
 * A generated list a keyboard and a screen reader can drive whole (#192):
 * sorted from its headers, its result count said after a filter, and its rows
 * reachable when they scroll inside their own region.
 */
test('a header sorts the list, and says which way', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es/customers');
  const table = new EntityTablePage(page);
  await table.waitForRows();
  const name = page.getByRole('columnheader', { name: /Nombre/ });

  await name.getByRole('button').click();
  await expect(name).toHaveAttribute('aria-sort', 'ascending');
  const ascending = await table.columnValues('Nombre');
  expect(ascending).toEqual(
    [...ascending].sort((left, right) => left.localeCompare(right, 'es')),
  );

  await name.getByRole('button').click();
  await expect(name).toHaveAttribute('aria-sort', 'descending');
});

test('filtering says how many results are left', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es/customers');
  const table = new EntityTablePage(page);
  await table.waitForRows();

  await table.filterBy({ member: 'name', operator: 'like', value: 'Ada' });

  await expect(page.getByRole('status').first()).toHaveText(/^1 resultado/);
  await expect(
    page.getByRole('group', { name: 'Filtros aplicados' }),
  ).toContainText('Nombre');
});

test('a list taller than its region is reachable by Tab', async ({ page }) => {
  failOnPageErrors(page);
  // A short viewport holds the region to fewer rows than the list has.
  await page.setViewportSize({ width: 1600, height: 150 });
  await page.goto('/es/customers');
  await new EntityTablePage(page).waitForRows();

  const region = page.getByRole('region', { name: /Clientes/ });
  await expect(region).toBeVisible();

  let reached = false;
  for (let stop = 0; stop < 40 && !reached; stop += 1) {
    await page.keyboard.press('Tab');
    reached = await region.evaluate(node => node.matches(':focus'));
  }
  expect(reached).toBe(true);
});

test('the filter panel shows how many records hold each choice', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/invoices');
  const table = new EntityTablePage(page);
  await table.waitForRows();

  await table.openFilters();
  await page.getByRole('button', { name: 'Añadir filtro' }).click();
  await page.getByLabel('Miembro del filtro').selectOption('status');

  await expect(
    page.getByLabel('Valor del filtro').getByRole('option', {
      name: /^Borrador \(\d+\)$/,
    }),
  ).toHaveCount(1);
});
