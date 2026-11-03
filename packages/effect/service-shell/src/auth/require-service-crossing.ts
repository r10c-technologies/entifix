import { Context } from 'effect';

/**
 * The header carrying the crossing secret.
 *
 * ⚠️ **Deliberately not `x-service-token`.** That header is config-service's
 * fleet lookup, and the two secrets are not comparable: one grants a
 * configuration *read*, this one a tenant-data *write* for any organization the
 * caller names. Sharing the header name is how a proxy configured to forward the
 * fleet token ends up presenting it to a route that writes stock, and how a
 * copy-pasted value looks right while being the wrong secret entirely.
 */
export const CROSSING_TOKEN_HEADER = 'x-crossing-token';

/**
 * The header naming the organization the caller is acting for.
 *
 * It rides beside the token rather than inside the request body because
 * entities are organization-agnostic by rule — no `organizationId` member, no
 * tenant filter — so there is nowhere in an entity envelope for it to live. A
 * header also serves the crossings that carry no body at all (releasing a hold,
 * converting one), which a body field would have needed a second convention for.
 *
 * On its own it grants **nothing**: it is only read after the token has proved
 * the caller is the fleet, so the input the caller controls is never the input
 * that authorizes.
 */
export const ORGANIZATION_HEADER = 'x-organization-id';

/**
 * The crossing secret this service expects, provided at the composition root
 * from its own configuration.
 *
 * A `Context.Tag` rather than an environment read: the value is a per-service secret held in
 * config-service as an `is_secret` row, so it arrives through the same boot
 * fetch as `mongo.uri` and can be rotated without redeploying a container.
 */
export class ServiceCrossingTokenTag extends Context.Service<
  ServiceCrossingTokenTag,
  string
>()('ServiceCrossingTokenTag') {}
