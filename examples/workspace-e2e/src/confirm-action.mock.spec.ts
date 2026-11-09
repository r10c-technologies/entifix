import { expectNoNewViolations } from './a11y';
import { expect, failOnPageErrors, test } from './support';

/**
 * A Server Action form that asks before it acts (ADR 0026), on a page with no
 * client boundary of its own. Ending the subscription is the destructive act.
 */
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the first post lands on an interstitial, and only the second acts', async ({
    page,
  }) => {
    await page.goto('/es/subscription');
    const status = page.getByTestId('subscription-status');
    await expect(status).toHaveText('Su suscripción está activa.');

    await page.getByRole('button', { name: 'Dar de baja' }).click();

    const step = page.getByRole('region', {
      name: '¿Dar de baja la suscripción?',
    });
    await expect(step).toBeVisible();
    await expect(step).toContainText('Dejará de recibir los envíos desde hoy.');
    await expect(status).toHaveText('Su suscripción está activa.');

    await step.getByRole('button', { name: 'Dar de baja' }).click();
    await expect(status).toHaveText('Su suscripción terminó.');
  });

  test('Cancel on the interstitial keeps the subscription', async ({
    page,
  }) => {
    await page.goto('/es/subscription');
    await page.getByRole('button', { name: 'Dar de baja' }).click();

    await page.getByRole('button', { name: 'Conservar' }).click();

    await expect(page.getByTestId('subscription-status')).toHaveText(
      'Su suscripción está activa.',
    );
    await expect(
      page.getByRole('button', { name: 'Dar de baja' }),
    ).toBeVisible();
  });
});

test('with JavaScript, a dialog asks with Cancel focused, then the post acts', async ({
  page,
}) => {
  failOnPageErrors(page);
  await page.goto('/es/subscription');
  const status = page.getByTestId('subscription-status');

  await page.getByRole('button', { name: 'Dar de baja' }).click();
  const dialog = page.getByRole('alertdialog', {
    name: '¿Dar de baja la suscripción?',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Conservar' })).toBeFocused();
  await expectNoNewViolations(page, 'subscription-confirm');

  await dialog.getByRole('button', { name: 'Dar de baja' }).click();
  await expect(status).toHaveText('Su suscripción terminó.');
});
