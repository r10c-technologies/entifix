import {
  makeStaticPolicyDecision,
  makeStaticServiceCrossingPolicy,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import {
  IdempotencyKeyTag,
  IdempotencyStoreTag,
  InvalidToken,
  OrganizationIdTag,
  RequestPrincipalTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import {
  ACCESS_COOKIE,
  defineEndpoint,
  Failure,
  formBody,
  IDEMPOTENCY_KEY_HEADER,
  implement,
  PROBLEM_CONTENT_TYPE,
  textBody,
  Unavailable,
} from '@entifix/core';
import { makeInMemoryIdempotencyStore } from '@entifix/testing-unit';
import { Context, Effect, Layer, Redacted, Schema } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/http';
import { HttpApiBuilder, HttpApiSecurity, OpenApi } from 'effect/http-api';
import { afterAll, describe, expect, it } from 'vitest';

import {
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
  ServiceCrossingTokenTag,
} from '../auth/require-service-crossing.js';
import { IDEMPOTENT_REPLAY_HEADER } from '../idempotency.js';
import { defaultFailurePolicy, extendFailurePolicy } from '../respond.js';
import { buildApi, endpointGroup, endpointsOf, serveApi } from './build-api.js';
import { FleetTokenTag } from './guards.js';

/*
 * The behaviours of `effect/http-api` that ADR 0020 relies on, pinned. The
 * module is `@stability unstable`: an `effect` bump that changes one fails here
 * rather than in a host.
 */

class SlugTaken extends Failure.conflict<SlugTaken>()(
  'SpecSlugTaken',
  'specSlugTaken',
  { slug: Schema.String },
) {}

class PotRefused extends Failure.declined<PotRefused>()(
  'SpecPotRefused',
  'specPotRefused',
) {}

class NotDeclared extends Failure.conflict<NotDeclared>()(
  'SpecNotDeclared',
  'specNotDeclared',
) {}

const claim = defineEndpoint({
  name: 'claim',
  method: 'POST',
  path: '/api/slug/:slug',
  params: { slug: Schema.String },
  query: { times: Schema.optional(Schema.FiniteFromString) },
  success: Schema.Struct({ slug: Schema.String, times: Schema.Number }),
  errors: [SlugTaken],
  guard: { kind: 'public' },
});

const brew = defineEndpoint({
  name: 'brew',
  method: 'POST',
  path: '/api/pot',
  success: Schema.String,
  errors: [PotRefused],
  guard: { kind: 'public' },
});

const boom = defineEndpoint({
  name: 'boom',
  method: 'GET',
  path: '/api/boom',
  success: Schema.String,
  errors: [],
  guard: { kind: 'public' },
});

const stray = defineEndpoint({
  name: 'stray',
  method: 'GET',
  path: '/api/stray',
  success: Schema.String,
  errors: [],
  guard: { kind: 'public' },
});

const me = defineEndpoint({
  name: 'me',
  method: 'GET',
  path: '/api/me',
  success: Schema.Struct({ userId: Schema.String }),
  errors: [],
  guard: { kind: 'session' },
});

const secret = defineEndpoint({
  name: 'secret',
  method: 'GET',
  path: '/api/secret',
  success: Schema.String,
  errors: [],
  guard: { kind: 'permission', permission: 'spec:secret:read' },
});

const tenant = defineEndpoint({
  name: 'tenant',
  method: 'GET',
  path: '/api/tenant',
  success: Schema.String,
  errors: [],
  guard: { kind: 'organization', permission: 'spec:secret:read' },
});

const reserve = defineEndpoint({
  name: 'reserve',
  method: 'POST',
  path: '/api/reserve',
  payload: Schema.Struct({ sku: Schema.String }),
  success: Schema.Struct({ organizationId: Schema.String, key: Schema.String }),
  errors: [],
  guard: {
    kind: 'crossing',
    permission: 'spec:reservation:write',
    organization: true,
  },
  idempotent: 'unit',
});

const release = defineEndpoint({
  name: 'release',
  method: 'POST',
  path: '/api/release',
  success: Schema.String,
  errors: [],
  guard: {
    kind: 'crossing',
    permission: 'spec:reservation:write',
    organization: false,
  },
});

const forbiddenCrossing = defineEndpoint({
  name: 'forbiddenCrossing',
  method: 'POST',
  path: '/api/forbidden-crossing',
  success: Schema.String,
  errors: [],
  guard: {
    kind: 'crossing',
    permission: 'spec:other:write',
    organization: false,
  },
});

const charge = defineEndpoint({
  name: 'charge',
  method: 'POST',
  path: '/api/charge/:id',
  params: { id: Schema.String },
  payload: Schema.Struct({ amount: Schema.Number }),
  success: Schema.Struct({ charged: Schema.Number }),
  errors: [],
  guard: { kind: 'session' },
  idempotent: 'edge',
});

const settle = defineEndpoint({
  name: 'settle',
  method: 'POST',
  path: '/api/settle',
  success: Schema.Struct({ settled: Schema.Boolean }),
  errors: [],
  guard: {
    kind: 'crossing',
    permission: 'spec:reservation:write',
    organization: false,
  },
  idempotent: 'edge',
});

const lookup = defineEndpoint({
  name: 'lookup',
  method: 'GET',
  path: '/api/lookup',
  success: Schema.String,
  errors: [],
  guard: { kind: 'fleet' },
});

/** A webhook whose authentication is a MAC over the bytes, and its header. */
const hook = defineEndpoint({
  name: 'hook',
  method: 'POST',
  path: '/api/hook',
  payload: textBody('application/json'),
  headers: { 'x-signature': Schema.String },
  success: Schema.Struct({ body: Schema.String, signature: Schema.String }),
  errors: [],
  guard: { kind: 'public' },
});

/** A caller a specification makes post a form. */
const logout = defineEndpoint({
  name: 'logout',
  method: 'POST',
  path: '/api/form-logout',
  payload: formBody({ logout_token: Schema.String }),
  success: Schema.String,
  errors: [],
  guard: { kind: 'public' },
});

let charges = 0;

const groups = [
  endpointGroup(
    'open',
    implement(claim, ({ params, query }) =>
      params.slug === 'taken'
        ? Effect.fail(new SlugTaken({ slug: params.slug }))
        : Effect.succeed({ slug: params.slug, times: query.times ?? 1 }),
    ),
    implement(brew, () => Effect.fail(new PotRefused())),
    implement(hook, ({ payload, headers }) =>
      Effect.succeed({ body: payload, signature: headers['x-signature'] }),
    ),
    implement(logout, ({ payload }) => Effect.succeed(payload.logout_token)),
    implement(boom, () => Effect.die(new Error('the password is hunter2'))),
    implement(
      stray,
      () => Effect.fail(new NotDeclared()) as unknown as Effect.Effect<string>,
    ),
  ),
  endpointGroup(
    'guarded',
    implement(me, () =>
      Effect.map(RequestPrincipalTag, who => ({ userId: String(who.userId) })),
    ),
    implement(secret, () => Effect.succeed('the secret')),
    implement(tenant, () => OrganizationIdTag),
    implement(reserve, () =>
      Effect.all({ organizationId: OrganizationIdTag, key: IdempotencyKeyTag }),
    ),
    implement(release, () => Effect.succeed('released')),
    implement(forbiddenCrossing, () => Effect.succeed('never')),
    implement(charge, ({ payload }) =>
      Effect.sync(() => {
        charges += 1;
        return { charged: payload.amount };
      }),
    ),
    implement(lookup, () => Effect.succeed('looked up')),
    implement(settle, () => Effect.succeed({ settled: true })),
  ),
] as const;

const policy = extendFailurePolicy(defaultFailurePolicy, {
  tagStatus: { SpecPotRefused: 418 },
});

const api = buildApi('spec', groups, { policy });

const fakeTokens = TokenServiceTag.of({
  sign: claims => Effect.succeed(JSON.stringify(claims)),
  verify: token =>
    Effect.try({
      try: () => JSON.parse(token) as TokenClaims,
      catch: () => new InvalidToken(),
    }),
});

const tokenFor = (roles: readonly string[], organization?: string) =>
  JSON.stringify({
    userId: 'user-1',
    subject: 'user-1',
    sessionId: 'session-1',
    roles,
    ...(organization === undefined
      ? {}
      : { activeOrganizationId: organization }),
  } satisfies TokenClaims);

const CROSSING_SECRET = 'crossing-secret';
const FLEET_SECRET = 'fleet-secret';

const routes = serveApi(api, groups, { policy }).pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(TokenServiceTag, fakeTokens),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({ admin: ['spec:secret:read'], user: [] }),
      ),
      Layer.succeed(ServiceCrossingTokenTag, CROSSING_SECRET),
      Layer.succeed(
        ServiceCrossingPolicyTag,
        makeStaticServiceCrossingPolicy(['spec:reservation:write']),
      ),
      Layer.succeed(FleetTokenTag, {
        header: 'x-service-token',
        token: () => FLEET_SECRET,
      }),
      Layer.succeed(
        IdempotencyStoreTag,
        makeInMemoryIdempotencyStore({ retentionMs: 60_000 }),
      ),
      HttpServer.layerServices,
    ),
  ),
);

const { handler, dispose } = HttpRouter.toWebHandler(routes, {
  disableLogger: true,
});
afterAll(() => dispose());

const call = async (path: string, init: RequestInit = {}) => {
  const response = await handler(
    new Request(`http://spec${path}`, init),
    Context.empty() as never,
  );
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    headers: response.headers,
    body: (text === '' ? undefined : JSON.parse(text)) as
      Record<string, unknown> | undefined,
  };
};

const session = (roles: readonly string[], organization?: string) => ({
  cookie: `${ACCESS_COOKIE}=${encodeURIComponent(tokenFor(roles, organization))}`,
});

describe('a business failure', () => {
  it('answers its category status and the RFC 9457 body', async () => {
    const answer = await call('/api/slug/taken', { method: 'POST' });

    expect(answer.status).toBe(409);
    expect(answer.type).toBe(PROBLEM_CONTENT_TYPE);
    expect(answer.body).toMatchObject({
      type: 'urn:entifix:failure:specSlugTaken',
      title: 'SpecSlugTaken',
      status: 409,
      code: 'specSlugTaken',
      category: 'conflict',
      slug: 'taken',
      instance: '/api/slug/taken',
    });
  });

  it('answers the status a policy override names for its tag', async () => {
    const answer = await call('/api/pot', { method: 'POST' });

    expect(answer.status).toBe(418);
    expect(answer.body).toMatchObject({ code: 'specPotRefused', status: 418 });
  });

  it('still answers its problem when the endpoint did not declare it', async () => {
    const answer = await call('/api/stray');

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'specNotDeclared' });
  });
});

describe('a payload that is not JSON', () => {
  it('hands a text body over as the exact bytes, beside the header it declared', async () => {
    // Spacing a JSON parse would normalise away: a MAC over these bytes is
    // what the handler has to be able to check.
    const raw = '{ "subject":"u-1",  "endsSessions":true }';
    const res = await call('/api/hook', {
      method: 'POST',
      // A provider signing a JSON body still sends it as JSON.
      headers: { 'content-type': 'application/json', 'x-signature': 'mac' },
      body: raw,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ body: raw, signature: 'mac' });
  });

  it('refuses a text endpoint without the header it declared', async () => {
    const res = await call('/api/hook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(400);
    expect(res.type).toContain(PROBLEM_CONTENT_TYPE);
  });

  it('decodes a form body', async () => {
    const res = await call('/api/form-logout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'logout_token=the-token',
    });

    expect(res.status).toBe(200);
    expect(res.body).toBe('the-token');
  });

  it('answers no-store unless the endpoint chose a cache policy', async () => {
    const res = await call('/api/form-logout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'logout_token=the-token',
    });
    const refused = await call('/api/pot', { method: 'POST' });

    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(refused.headers.get('cache-control')).toBe('no-store');
  });
});

describe('a request that fails its schema', () => {
  it('answers invalid with a pointer per broken field, never an empty 400', async () => {
    const answer = await call('/api/slug/free?times=many', { method: 'POST' });

    expect(answer.status).toBe(400);
    expect(answer.type).toBe(PROBLEM_CONTENT_TYPE);
    expect(answer.body).toMatchObject({ code: 'invalid' });
    expect(answer.body?.['errors']).toEqual([
      expect.objectContaining({ pointer: '/query/times', code: 'schema' }),
    ]);
  });

  it('answers invalid for a body that does not decode', async () => {
    const answer = await call('/api/charge/c1', {
      method: 'POST',
      headers: {
        ...session(['user']),
        'content-type': 'application/json',
        [IDEMPOTENCY_KEY_HEADER]: '"k-bad"',
      },
      body: JSON.stringify({ amount: 'lots' }),
    });

    expect(answer.status).toBe(400);
    expect(answer.body?.['errors']).toEqual([
      expect.objectContaining({ pointer: '/payload/amount' }),
    ]);
  });

  it('points at the body itself when the whole body is wrong', async () => {
    const answer = await call('/api/charge/c1', {
      method: 'POST',
      headers: {
        ...session(['user']),
        'content-type': 'application/json',
        [IDEMPOTENCY_KEY_HEADER]: '"k-root"',
      },
      body: JSON.stringify([1, 2]),
    });

    expect(answer.status).toBe(400);
    expect(answer.body?.['errors']).toEqual([
      expect.objectContaining({ pointer: '/payload' }),
    ]);
  });

  it('decodes and passes what does', async () => {
    const answer = await call('/api/slug/free?times=3', { method: 'POST' });

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ slug: 'free', times: 3 });
  });
});

describe('a defect', () => {
  it('answers a 500 problem with nothing of the defect in it', async () => {
    const answer = await call('/api/boom');

    expect(answer.status).toBe(500);
    expect(answer.type).toBe(PROBLEM_CONTENT_TYPE);
    expect(answer.body).toMatchObject({ code: 'internal' });
    expect(JSON.stringify(answer.body)).not.toContain('hunter2');
  });
});

describe('the guards', () => {
  it('answer 401 on an empty cookie, an empty bearer and an empty crossing token', async () => {
    const emptyCookie = await call('/api/me', {
      headers: { cookie: `${ACCESS_COOKIE}=` },
    });
    const emptyBearer = await call('/api/me', {
      headers: { authorization: 'Bearer ' },
    });
    const emptyCrossing = await call('/api/release', {
      method: 'POST',
      headers: { [CROSSING_TOKEN_HEADER]: '' },
    });

    for (const answer of [emptyCookie, emptyBearer, emptyCrossing]) {
      expect(answer.status).toBe(401);
      expect(answer.body).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('provide the verified principal to a session endpoint', async () => {
    const answer = await call('/api/me', { headers: session(['user']) });

    expect(answer.body).toEqual({ userId: 'user-1' });
  });

  it('read the permission off the endpoint they guard', async () => {
    const refused = await call('/api/secret', { headers: session(['user']) });
    const allowed = await call('/api/secret', { headers: session(['admin']) });

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      code: 'forbidden',
      permission: 'spec:secret:read',
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toBe('the secret');
  });

  it('take the organization from the session and refuse a session with none', async () => {
    const none = await call('/api/tenant', { headers: session(['admin']) });
    const acting = await call('/api/tenant', {
      headers: session(['admin'], 'org-7'),
    });

    expect(none.status).toBe(409);
    expect(none.body).toMatchObject({ code: 'noActiveOrganization' });
    expect(acting.status).toBe(200);
  });

  it('let a crossing name its organization, and require it when declared', async () => {
    const headers = {
      [CROSSING_TOKEN_HEADER]: CROSSING_SECRET,
      [IDEMPOTENCY_KEY_HEADER]: '"flow-1:reserve"',
      'content-type': 'application/json',
    };
    const named = await call('/api/reserve', {
      method: 'POST',
      headers: { ...headers, [ORGANIZATION_HEADER]: 'org-3' },
      body: JSON.stringify({ sku: 's1' }),
    });
    const unnamed = await call('/api/reserve', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sku: 's1' }),
    });

    expect(named.body).toEqual({
      organizationId: 'org-3',
      key: 'flow-1:reserve',
    });
    expect(unnamed.status).toBe(400);
    expect(unnamed.body).toMatchObject({ code: 'invalid' });
  });

  it('refuse a crossing permission the policy does not allow', async () => {
    const answer = await call('/api/forbidden-crossing', {
      method: 'POST',
      headers: { [CROSSING_TOKEN_HEADER]: CROSSING_SECRET },
    });

    expect(answer.status).toBe(403);
  });

  it('refuse a crossing request that also carries a session', async () => {
    const answer = await call('/api/release', {
      method: 'POST',
      headers: {
        [CROSSING_TOKEN_HEADER]: CROSSING_SECRET,
        ...session(['admin']),
      },
    });

    expect(answer.status).toBe(401);
  });

  it('let a fleet endpoint through on the shared token only', async () => {
    const without = await call('/api/lookup');
    const withToken = await call('/api/lookup', {
      headers: { 'x-service-token': FLEET_SECRET },
    });

    expect(without.status).toBe(401);
    expect(withToken.status).toBe(200);
  });
});

describe('idempotency', () => {
  it('answers 400 without an Idempotency-Key on an idempotent endpoint', async () => {
    const answer = await call('/api/release', {
      method: 'POST',
      headers: { [CROSSING_TOKEN_HEADER]: CROSSING_SECRET },
    });
    const missing = await call('/api/reserve', {
      method: 'POST',
      headers: {
        [CROSSING_TOKEN_HEADER]: CROSSING_SECRET,
        [ORGANIZATION_HEADER]: 'org-3',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sku: 's1' }),
    });

    expect(answer.status).toBe(200);
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ code: 'idempotencyKeyMissing' });
  });

  it('remembers an edge answer and replays it without running the handler twice', async () => {
    const send = () =>
      call('/api/charge/c1', {
        method: 'POST',
        headers: {
          ...session(['user']),
          'content-type': 'application/json',
          [IDEMPOTENCY_KEY_HEADER]: '"charge-1"',
        },
        body: JSON.stringify({ amount: 5 }),
      });
    const before = charges;

    const first = await send();
    const second = await send();

    expect(first.body).toEqual({ charged: 5 });
    expect(second.body).toEqual({ charged: 5 });
    expect(second.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
    expect(charges - before).toBe(1);
  });

  it('keys an edge answer to the service on an endpoint with no session', async () => {
    const send = () =>
      call('/api/settle', {
        method: 'POST',
        headers: {
          [CROSSING_TOKEN_HEADER]: CROSSING_SECRET,
          [IDEMPOTENCY_KEY_HEADER]: '"settle-1"',
        },
      });

    expect((await send()).body).toEqual({ settled: true });
    expect((await send()).headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
  });

  it('refuses one key reused on another record of the same route', async () => {
    const send = (id: string) =>
      call(`/api/charge/${id}`, {
        method: 'POST',
        headers: {
          ...session(['user']),
          'content-type': 'application/json',
          [IDEMPOTENCY_KEY_HEADER]: '"charge-shared"',
        },
        body: JSON.stringify({ amount: 5 }),
      });

    expect((await send('c1')).status).toBe(200);
    const reused = await send('c2');
    expect(reused.status).toBe(422);
    expect(reused.body).toMatchObject({ code: 'idempotencyKeyReused' });
  });
});

describe('the built API', () => {
  it('lists its endpoints as METHOD /path', () => {
    expect(endpointsOf(groups)).toContain('POST /api/slug/:slug');
    expect(endpointsOf(groups)).toHaveLength(15);
  });

  it('refuses two endpoints on one method and path', () => {
    expect(() =>
      buildApi('twice', [
        endpointGroup(
          'a',
          implement(boom, () => Effect.succeed('a')),
        ),
        endpointGroup(
          'b',
          implement(boom, () => Effect.succeed('b')),
        ),
      ]),
    ).toThrow("'twice' declares GET /api/boom twice");
  });

  it('documents each failure with its status and the problem content type', () => {
    const document = OpenApi.fromApi(api as never);
    const responses = document.paths['/api/slug/{slug}']?.post?.responses;

    expect(Object.keys(responses ?? {})).toEqual(
      expect.arrayContaining(['200', '409', '400', '500', '503']),
    );
    expect(Object.keys(responses?.['409']?.content ?? {})).toEqual([
      PROBLEM_CONTENT_TYPE,
    ]);
    expect(
      Object.keys(document.paths['/api/pot']?.post?.responses ?? {}),
    ).toContain('418');
  });
});

describe('what the guards do not use, and why', () => {
  it('a security scheme decodes a missing credential as an empty Redacted', async () => {
    // Pinned because it is why the guards read the request themselves: a
    // scheme hands a middleware `Redacted('')`, which reads as present.
    const credential = await Effect.runPromise(
      HttpApiBuilder.securityDecode(
        HttpApiSecurity.apiKey({ in: 'header', key: 'x-absent' }),
      ).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(new Request('http://spec/')),
        ),
        Effect.provideService(HttpServerRequest.ParsedSearchParams, {}),
      ),
    );

    expect(Redacted.value(credential)).toBe('');
  });

  it('a technical failure needs no declaration to answer its problem', async () => {
    const throttled = implement(stray, () => Effect.fail(new Unavailable({})));

    expect(throttled.descriptor.errors).toEqual([]);
  });
});
