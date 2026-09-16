import { expect, failOnPageErrors, test } from './support';

/**
 * A draft outlives the page; a saved record does not.
 *
 * The workspace writes every edit to IndexedDB under the tab's address, so a
 * reload restores the half-typed value — and the same store is what marks the
 * tab dirty and makes closing it ask first.
 */
const TAB = '/es/workspace?tab=master:customer:c-2';

test('restores an unsaved edit after a reload', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto(TAB);

  const name = page.getByLabel('Nombre');
  await expect(name).toHaveValue('Alan Turing');
  await name.fill('Alan, unsaved');
  await expect(page.getByTestId('tab-indicator')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Nombre')).toHaveValue('Alan, unsaved');
});

test('asks before closing a tab that holds a draft', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto(TAB);

  await page.getByLabel('Nombre').fill('Alan, unsaved');
  await expect(page.getByTestId('tab-indicator')).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar Cliente #c-2' }).click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Nombre')).toHaveValue('Alan, unsaved');
});
