import { EntityTablePage } from '@entifix/testing-e2e/playwright';

import { expect, failOnPageErrors, test } from './support';

/** An example seed id, or a UUID: a key where a name belongs. */
const RAW_ID =
  /\b[cip]-\d+\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * Lists, records and breadcrumbs name what they show (#200): an id is a key,
 * and a reader came to see which record it is.
 */
test('a list names the record an id refers to', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es/invoices');
  const table = new EntityTablePage(page);
  await table.waitForRows();

  await expect(
    page.getByRole('cell', { name: 'Ada Lovelace', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(RAW_ID);
});

test('a record and its breadcrumb name it, never its id', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es/invoices');
  await new EntityTablePage(page).waitForRows();
  await page.getByRole('link', { name: 'INV-0001' }).click();
  await expect(page.getByLabel('Número')).toHaveValue('INV-0001');

  const crumbs = page.getByRole('navigation', { name: 'Ruta de navegación' });
  await expect(crumbs).toContainText('INV-0001');
  await expect(page.getByRole('main')).not.toContainText(RAW_ID);
});

/**
 * A payment names the invoice it settles, and a branch names its parent
 * account: references read in one request per entity, through the host's
 * registry (ADR 0030).
 */
for (const [list, name, cells] of [
  // The invoice a payment settles, by its number.
  ['payments', 'INV-0001', 1],
  // Grace Hopper's own row, and the branch whose parent she is.
  ['customers', 'Grace Hopper', 2],
] as const) {
  test(`the ${list} list names every record it refers to`, async ({ page }) => {
    failOnPageErrors(page);
    await page.goto(`/es/${list}`);
    await new EntityTablePage(page).waitForRows();
    await expect(
      page.getByRole('table').getByRole('cell', { name, exact: true }),
    ).toHaveCount(cells);
    await expect(page.getByRole('main')).not.toContainText(RAW_ID);
  });
}

/**
 * A related column: each customer's invoices, read for the whole page in one
 * request — the number when there is one, a dash when there is none — and a
 * header that offers no sort, since the value lives in another store.
 */
test('a list shows a related entity’s value as a column', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es/customers');
  await new EntityTablePage(page).waitForRows();
  const table = page.getByRole('table');
  const header = table.getByRole('columnheader', { name: 'Facturas' });
  await expect(header).toBeVisible();
  await expect(header).not.toHaveAttribute('aria-sort');
  await expect(header.getByRole('button')).toHaveCount(0);
  await expect(
    table.getByRole('row', { name: /Ada Lovelace/ }).getByText('INV-0001'),
  ).toBeVisible();
});
