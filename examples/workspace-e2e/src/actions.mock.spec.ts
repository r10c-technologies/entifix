import { EntityTablePage } from '@entifix/testing-e2e/playwright';

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
