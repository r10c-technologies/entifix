import { EntityTablePage } from '@entifix/testing-e2e/playwright';

import { expectFocusKept, expectNoNewViolations } from './a11y';
import { expect, failOnPageErrors, test } from './support';

/**
 * "New" is the list's primary, rendered only where something can be created
 * (ADR 0026): the entity is one a person creates, and the caller may write it.
 */
test('a list offers "New" as its primary where the caller may create', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/customers');
  await new EntityTablePage(page).waitForRows();

  const create = page.getByRole('link', { name: 'Nuevo' });
  await expect(create).toBeVisible();
  // A primary button, not a text link: it wears the primary fill.
  await expect(create).toHaveClass(/bg-primary/);
});

test('an entity no person creates shows no "New"', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es/payments');
  await new EntityTablePage(page).waitForRows();

  await expect(page.getByRole('link', { name: 'PAY-0001' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nuevo' })).toHaveCount(0);
});

test('a caller who may only read sees no "New"', async ({
  page,
  context,
  baseURL,
}) => {
  failOnPageErrors(page);
  // Stands in for a principal whose served `$metadata` holds only `read`.
  await context.addCookies([
    { name: 'example-role', value: 'viewer', url: baseURL as string },
  ]);
  await page.goto('/es/customers');
  await new EntityTablePage(page).waitForRows();

  await expect(page.getByRole('link', { name: 'Ada Lovelace' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nuevo' })).toHaveCount(0);
});

/**
 * Delete on a generated record page asks, in an alert dialog named for the
 * record, with Cancel focused and the verb on the button — and once confirmed
 * the reader lands on the list's heading and hears what happened.
 */
test('Delete confirms by name, then lands on the list heading and says so', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/customers');
  const table = new EntityTablePage(page);
  await table.waitForRows();
  await page.getByRole('link', { name: 'Alan Turing' }).click();
  await expect(page.getByLabel('Nombre')).toHaveValue('Alan Turing');

  await page.getByRole('button', { name: 'Eliminar' }).click();
  const dialog = page.getByRole('alertdialog', {
    name: '¿Eliminar Alan Turing?',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await expectNoNewViolations(page, 'customer-delete');

  await dialog.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page).toHaveURL(/\/es\/customers$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page.getByTestId('toast-region').getByRole('status')).toHaveText(
    /Se eliminó Alan Turing\./,
  );
  await table.waitForRows();
  expect(await table.columnValues('Nombre')).not.toContain('Alan Turing');
  await expectFocusKept(page);
});

test('a destructive toolbar verb asks before it acts on the whole list', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/invoices');
  const table = new EntityTablePage(page);
  await table.waitForRows();
  const before = await table.columnValues('Número');

  await page.getByRole('button', { name: 'Eliminar borradores' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await expect(dialog).toHaveCount(0);
  expect(await table.columnValues('Número')).toEqual(before);
});

test('an undo verb acts at once, and Undo puts it back', async ({ page }) => {
  failOnPageErrors(page);
  await page.goto('/es/invoices');
  const table = new EntityTablePage(page);
  await table.waitForRows();
  const row = table.rows.filter({ hasText: 'INV-0002' });

  await row.getByRole('button', { name: 'Acciones para INV-0002' }).click();
  await page.getByRole('menuitem', { name: 'Anular' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(row).toContainText('Anulada');
  await expect(page.getByTestId('toast-region').getByRole('status')).toHaveText(
    /Factura anulada\./,
  );

  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(row).toContainText('Borrador');
});
