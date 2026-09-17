import type { Page } from '@playwright/test';

import { expect, failOnPageErrors, test } from './support';

/**
 * Following a generated link never reloads the page (#20).
 *
 * A marker is planted on the page's global object first; a document load would wipe it, along
 * with the bundle, every cache and — in this example — every saved record.
 */
const plantMarker = (page: Page) =>
  page.evaluate(() => {
    (globalThis as unknown as Record<string, unknown>)['__noReload'] = true;
  });

const markerSurvived = (page: Page) =>
  page.evaluate(
    () =>
      (globalThis as unknown as Record<string, unknown>)['__noReload'] === true,
  );

test('a list tab opens a record, and its create form, as tabs', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/workspace?tab=master:customer');
  await expect(page.getByRole('cell', { name: 'Ada Lovelace' })).toBeVisible();
  await plantMarker(page);

  await page
    .getByRole('row')
    .filter({ hasText: 'Ada Lovelace' })
    .getByRole('link', { name: 'Abrir' })
    .click();

  await expect(page).toHaveURL(
    /tab=master%3Acustomer%3Ac-1|tab=master:customer:c-1/,
  );
  await expect(page.getByLabel('Nombre')).toHaveValue('Ada Lovelace');

  await page.getByRole('link', { name: 'Volver' }).click();
  await expect(page).toHaveURL(/tab=master%3Acustomer$|tab=master:customer$/);

  await page.getByRole('link', { name: 'Nuevo' }).click();
  await expect(page).toHaveURL(
    /tab=master%3Acustomer%3Anew|tab=master:customer:new/,
  );
  await expect(page.getByText('Nuevo cliente')).toBeVisible();

  expect(await markerSurvived(page)).toBe(true);
});

test('a route host opens a record client-side', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es/customers');
  await expect(page.getByRole('cell', { name: 'Alan Turing' })).toBeVisible();
  await plantMarker(page);

  await page
    .getByRole('row')
    .filter({ hasText: 'Alan Turing' })
    .getByRole('link', { name: 'Abrir' })
    .click();

  await expect(page).toHaveURL(/\/es\/customers\/c-2$/);
  await expect(page.getByLabel('Nombre')).toHaveValue('Alan Turing');
  expect(await markerSurvived(page)).toBe(true);
});
