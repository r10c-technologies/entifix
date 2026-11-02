import { isTag } from '@entifix/core';

/**
 * A `404`, however it arrived: a service that answers a problem body says
 * `NotFound`; one that answers no body at all is a protocol failure that
 * still carries the status.
 */
export const isNotFound = (error: unknown): boolean =>
  isTag('NotFound')(error) ||
  (isTag('ProtocolFailure')(error) &&
    (error as { readonly upstreamStatus?: unknown }).upstreamStatus === 404);
