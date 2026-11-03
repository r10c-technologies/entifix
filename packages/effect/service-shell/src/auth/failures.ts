import { Failure } from '@entifix/core';

/**
 * A signed-in caller whose session names no organization, on a route that acts
 * for one. A member of several organizations hits it before choosing one; the
 * code is what a client renders as "select an organization" instead of
 * "forbidden".
 */
export class NoActiveOrganization extends Failure.conflict<NoActiveOrganization>()(
  'NoActiveOrganization',
  'noActiveOrganization',
) {}
