import { type EntifixEnvelope, formatIdempotencyKey } from '@entifix/core';

import { HttpMethod, HttpRequest } from '../../../clients/types.js';

export interface BuildEntityRequestOptions {
  method: HttpMethod;
  url: string;
  /**
   * The body, already wrapped as an envelope — every entifix message is one.
   * Omitted for reads and deletes, which carry no payload.
   */
  envelope?: EntifixEnvelope<unknown>;
  /** A write's `Idempotency-Key`, already minted by the caller. */
  idempotencyKey?: string;
}

/**
 * Assembles the {@link HttpRequest} the fetch client executes. Centralized so
 * the read and write adapters agree on how a message is framed — notably that a
 * body is always an {@link EntifixEnvelope}, and that the JSON content type is
 * declared only when there is one to declare.
 */
export const buildEntityRequest = ({
  method,
  url,
  envelope,
  idempotencyKey,
}: BuildEntityRequestOptions): HttpRequest<EntifixEnvelope<unknown>> => {
  const headers: Record<string, string> = {
    ...(envelope ? { 'Content-Type': 'application/json' } : {}),
    ...(idempotencyKey === undefined
      ? {}
      : { 'Idempotency-Key': formatIdempotencyKey(idempotencyKey) }),
  };
  return {
    method,
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(envelope ? { body: envelope } : {}),
  };
};
