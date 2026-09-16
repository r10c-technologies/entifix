import { baseTest } from '@entifix/testing-e2e/playwright';
import type { Page } from '@playwright/test';

/**
 * No network fixture and no session: this app talks to nothing but itself.
 *
 * Every journey starts from an empty browser context, so IndexedDB — tabs,
 * drafts, the wizard's state — is fresh and one spec cannot resume another's
 * work.
 */
export const test = baseTest;
export { expect } from '@playwright/test';

/** Fails the test on anything thrown in the page, which a render can swallow. */
export const failOnPageErrors = (page: Page) => {
  page.on('pageerror', error => {
    throw error;
  });
};
