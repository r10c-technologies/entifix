import { OpenApi } from 'effect/http-api';

import type { FailurePolicy } from '../respond.js';
import {
  type AnyEndpointGroup,
  type ApiOptions,
  buildApi,
  endpointsOf,
} from './build-api.js';
import { serviceGroup } from './service-group.js';

/** What a service's API is assembled from — the part of a definition that is not a server. */
export interface ServiceApiDefinition<
  Groups extends ReadonlyArray<AnyEndpointGroup> =
    ReadonlyArray<AnyEndpointGroup>,
> {
  readonly name: string;
  readonly slices: readonly string[];
  /** Whether the service names a `description` token, which mounts `$service` and `$openapi`. */
  readonly described: boolean;
  readonly endpoints?: Groups;
  readonly policy?: FailurePolicy;
}

/** A service's one `HttpApi`, with the groups and options it was built from. */
export interface ServiceApi {
  readonly api: ReturnType<typeof buildApi>;
  readonly groups: ReadonlyArray<AnyEndpointGroup>;
  readonly options: ApiOptions;
}

/**
 * The `HttpApi` a service serves: the endpoints every service has, then its
 * own. `makeServerLayer` serves exactly this, and a host that documents its
 * fleet calls it without a server, so the document it writes is the one the
 * service answers at `$openapi` rather than a second assembly that could drift.
 *
 * A fleet-guarded endpoint needs a token to check against, so a service that
 * serves one and is not described refuses to build.
 */
export const serviceApi = (def: ServiceApiDefinition): ServiceApi => {
  const hosted = def.endpoints ?? [];
  const fleetGuarded = hosted.flatMap(group =>
    group.endpoints.filter(
      ({ descriptor }) => descriptor.guard.kind === 'fleet',
    ),
  );
  if (fleetGuarded.length > 0 && !def.described)
    throw new Error(
      `'${def.name}' serves ${fleetGuarded
        .map(({ descriptor }) => `${descriptor.method} ${descriptor.path}`)
        .join(
          ', ',
        )} behind the fleet token and names no \`description\` to check it against`,
    );
  const base = serviceGroup({
    service: def.name,
    slices: def.slices,
    described: def.described,
    endpoints: () => endpointsOf(groups),
    api: () => api,
  });
  const groups: ReadonlyArray<AnyEndpointGroup> = [base, ...hosted];
  const options: ApiOptions =
    def.policy === undefined ? {} : { policy: def.policy };
  // One API per service: one encoder, one guard implementation, one OpenAPI.
  const api = buildApi(def.name, groups, options);
  return { api, groups, options };
};

/** The OpenAPI document a service answers at `$openapi`, built without serving it. */
export const serviceOpenApi = (def: ServiceApiDefinition) =>
  OpenApi.fromApi(serviceApi(def).api);
