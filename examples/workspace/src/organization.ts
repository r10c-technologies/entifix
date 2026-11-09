import { Failure } from '@entifix/core';

/**
 * Stands in for a session with no active organization — what a multi-tenant
 * host answers when a tenant list is asked for before one is chosen. Set it in
 * the browser to see the list refuse, and the refusal offer its way out.
 */
export const NO_ORGANIZATION_COOKIE = 'example-organization';

/** A tenant read asked for before an organization was chosen. */
export class NoActiveOrganization extends Failure.declined<NoActiveOrganization>()(
  'NoActiveOrganization',
  'noActiveOrganization',
) {}

/** Whether this browser has an organization to read under. */
export const hasOrganization = (): boolean =>
  !document.cookie.split('; ').includes(`${NO_ORGANIZATION_COOKIE}=none`);

/**
 * The action the failure offers: choose one. The example has a single
 * organization, so choosing it is clearing the cookie and reading again.
 */
export const chooseOrganization = (): void => {
  document.cookie = `${NO_ORGANIZATION_COOKIE}=; path=/; max-age=0`;
  window.location.reload();
};
