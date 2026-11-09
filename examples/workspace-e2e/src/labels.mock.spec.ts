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
