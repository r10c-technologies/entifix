import { Effect, Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  BUSINESS_CATEGORIES,
  defaultStatus,
  FAILURE_CATEGORIES,
  familyOf,
  TECHNICAL_CATEGORIES,
} from './failure.js';
import {
  Contention,
  Declined,
  DuplicateKey,
  Forbidden,
  IdempotencyKeyInFlight,
  IdempotencyKeyMissing,
  IdempotencyKeyReused,
  Internal,
  Invalid,
  InvalidEnvelope,
  InvalidQuery,
  NotFound,
  Overloaded,
  ProtocolFailure,
  Timeout,
  Unauthenticated,
  Unavailable,
  UpstreamUnavailable,
} from './generic.js';
import { Failure } from './index.js';
import { decodeProblem, PROBLEM_CONTENT_TYPE, problemOf } from './problem.js';
import {
  failureTypeUri,
  lookupFailure,
  registeredFailures,
  registerFailure,
} from './registry.js';

class SlugTaken extends Failure.conflict<SlugTaken>()(
  'SlugTaken',
  'specSlugTaken',
  { slug: Schema.String },
) {}

class StoreDown extends Failure.unavailable<StoreDown>()(
  'StoreDown',
  'specStoreDown',
) {}

describe('the category table', () => {
  it('is closed at twelve, six per family', () => {
    expect(FAILURE_CATEGORIES).toHaveLength(12);
    expect(Object.keys(BUSINESS_CATEGORIES)).toHaveLength(6);
    expect(Object.keys(TECHNICAL_CATEGORIES)).toHaveLength(6);
  });

  it('derives the family from the category', () => {
    expect(familyOf('declined')).toBe('business');
    expect(familyOf('timeout')).toBe('technical');
  });

  it('answers each category with its default status', () => {
    expect(defaultStatus('invalid')).toBe(400);
    expect(defaultStatus('conflict')).toBe(409);
    expect(defaultStatus('contention')).toBe(409);
    expect(defaultStatus('unavailable')).toBe(503);
  });
});

describe('a defined failure', () => {
  it('carries its code, category and family as literals', () => {
    const failure = new SlugTaken({ slug: 'aurora' });

    expectTypeOf(failure.code).toEqualTypeOf<'specSlugTaken'>();
    expectTypeOf(failure.category).toEqualTypeOf<'conflict'>();
    expectTypeOf(failure.family).toEqualTypeOf<'business'>();
    expect(failure).toMatchObject({
      _tag: 'SlugTaken',
      code: 'specSlugTaken',
      category: 'conflict',
      family: 'business',
      slug: 'aurora',
    });
  });

  it('is yieldable in an Effect, and fails it', async () => {
    const program = Effect.gen(function* () {
      return yield* new StoreDown();
    });

    const failure = await Effect.runPromise(Effect.flip(program));

    expect(failure.category).toBe('unavailable');
  });

  it('keeps its facts off the encoded fields', () => {
    expect(Schema.encodeSync(SlugTaken)(new SlugTaken({ slug: 'x' }))).toEqual({
      _tag: 'SlugTaken',
      slug: 'x',
    });
  });

  it('is registered under its code the moment it is defined', () => {
    expect(lookupFailure('specSlugTaken')).toMatchObject({
      tag: 'SlugTaken',
      category: 'conflict',
      family: 'business',
      type: 'urn:entifix:failure:specSlugTaken',
    });
  });

  it('refuses a field the problem body reserves', () => {
    expect(() =>
      Failure.invalid()('Shadowing', 'specShadowing', {
        status: Schema.Number,
        title: Schema.String,
      }),
    ).toThrow(/'status', 'title'.*reserves/);
  });
});

describe('the code registry', () => {
  it('throws at definition when a second tag claims a code', () => {
    expect(() => Failure.conflict()('AnotherTag', 'specSlugTaken', {})).toThrow(
      /already registered by 'SlugTaken'/,
    );
  });

  it('lets the same tag register its code again, as a reload does', () => {
    const entry = lookupFailure('specStoreDown');
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    expect(() => registerFailure(entry)).not.toThrow();
  });

  it('lists every failure ordered by code', () => {
    const codes = registeredFailures().map(entry => entry.code);

    expect(codes).toContain('specSlugTaken');
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
  });

  it('names a type URI per code', () => {
    expect(failureTypeUri('x')).toBe('urn:entifix:failure:x');
  });
});

describe('the predicates', () => {
  type Either = SlugTaken | StoreDown;
  const either = (failure: Either): Either => failure;

  it('narrow a union by tag, category and family', () => {
    const failure = either(new SlugTaken({ slug: 'a' }));

    if (Failure.isTag('SlugTaken')(failure))
      expectTypeOf(failure).toEqualTypeOf<SlugTaken>();
    if (Failure.isCategory('unavailable')(failure))
      expectTypeOf(failure).toEqualTypeOf<StoreDown>();
    if (Failure.isFamily('business')(failure))
      expectTypeOf(failure).toEqualTypeOf<SlugTaken>();

    expect(Failure.isTag('SlugTaken')(failure)).toBe(true);
    expect(Failure.isCategory('conflict')(failure)).toBe(true);
    expect(Failure.isFamily('technical')(failure)).toBe(false);
  });

  it('match by reading the value, never the prototype', () => {
    const decoded = { _tag: 'StoreDown', category: 'unavailable' };

    expect(Failure.isTag('StoreDown')(decoded)).toBe(true);
    expect(Failure.isCategory('unavailable')(decoded)).toBe(true);
    expect(Failure.isTag('StoreDown')(null)).toBe(false);
    expect(Failure.isTag('StoreDown')('StoreDown')).toBe(false);
  });

  it('recognise any failure', () => {
    expect(Failure.is(new StoreDown())).toBe(true);
    expect(Failure.is(new Error('plain'))).toBe(false);
    expect(Failure.is(null)).toBe(false);
  });

  it('combine with and, or and not', () => {
    const slug = either(new SlugTaken({ slug: 'a' }));
    const down = either(new StoreDown());
    const conflictingSlug = Failure.and(
      Failure.isFamily('business'),
      Failure.isTag('SlugTaken'),
    );
    const anyOfThem = Failure.or(
      Failure.isTag('SlugTaken'),
      Failure.isTag('StoreDown'),
    );
    const notBusiness = Failure.not(Failure.isFamily('business'));

    expect([conflictingSlug(slug), conflictingSlug(down)]).toEqual([
      true,
      false,
    ]);
    expect([anyOfThem(slug), anyOfThem(down), anyOfThem({})]).toEqual([
      true,
      true,
      false,
    ]);
    if (notBusiness(down)) expectTypeOf(down).toEqualTypeOf<StoreDown>();
    expect([notBusiness(slug), notBusiness(down)]).toEqual([false, true]);
  });

  it('pair a guard with a condition read from the context', async () => {
    const predicate = Failure.when(Failure.isTag('SlugTaken'), failure =>
      Effect.succeed(failure._tag === 'SlugTaken'),
    );

    expect(predicate.guard(new SlugTaken({ slug: 'a' }))).toBe(true);
    expect(
      await Effect.runPromise(
        predicate.condition(new SlugTaken({ slug: 'a' })),
      ),
    ).toBe(true);
  });
});

describe('the problem codec', () => {
  it('encodes a failure as an RFC 9457 body with the code on top', () => {
    expect(
      problemOf(new SlugTaken({ slug: 'aurora' }), {
        traceId: 'trace-1',
        instance: '/api/brand',
      }),
    ).toEqual({
      type: 'urn:entifix:failure:specSlugTaken',
      title: 'SlugTaken',
      status: 409,
      code: 'specSlugTaken',
      category: 'conflict',
      instance: '/api/brand',
      traceId: 'trace-1',
      slug: 'aurora',
    });
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json');
  });

  it('answers the status it is given over the category default', () => {
    expect(problemOf(new StoreDown(), { status: 502 }).status).toBe(502);
  });

  it('carries a message as the detail, and nothing when there is none', () => {
    expect(problemOf(new InvalidQuery({ reason: 'bad sort' })).detail).toBe(
      'bad sort',
    );
    expect(problemOf(new StoreDown())).not.toHaveProperty('detail');
  });

  it('encodes no fields for a failure nothing registered', () => {
    const stray = {
      _tag: 'Stray',
      code: 'specNeverRegistered',
      category: 'internal',
      family: 'technical',
      message: '',
      secret: 'x',
    } as const;

    expect(problemOf(stray)).not.toHaveProperty('secret');
  });

  it('encodes no fields when they do not encode', () => {
    const broken = Object.assign(new SlugTaken({ slug: 'a' }), { slug: 1 });

    expect(problemOf(broken)).not.toHaveProperty('slug');
  });

  it('decodes a body into the failure that was sent, with its fields', () => {
    const decoded = decodeProblem(problemOf(new SlugTaken({ slug: 'aurora' })));

    expect(decoded).toMatchObject({
      _tag: 'SlugTaken',
      code: 'specSlugTaken',
      category: 'conflict',
      slug: 'aurora',
    });
  });

  it.each([
    ['a string', 'boom'],
    ['an array', []],
    ['no code', { status: 500 }],
  ])('answers %s with a ProtocolFailure', (_label, body) => {
    expect(decodeProblem(body, 500)).toMatchObject({
      _tag: 'ProtocolFailure',
      reason: 'the error body is not a problem',
      upstreamStatus: 500,
    });
  });

  it('answers an unknown code with a ProtocolFailure', () => {
    expect(decodeProblem({ code: 'specNoSuchCode' })).toMatchObject({
      _tag: 'ProtocolFailure',
      reason: "the problem names an unknown code 'specNoSuchCode'",
    });
  });

  it('answers fields that do not decode with a ProtocolFailure', () => {
    expect(
      decodeProblem({ code: 'specSlugTaken', slug: 42 }, 409),
    ).toMatchObject({
      _tag: 'ProtocolFailure',
      reason: "the fields of 'specSlugTaken' do not decode",
      upstreamStatus: 409,
    });
  });
});

describe('the fleet-generic failures', () => {
  it.each([
    [new Invalid({ errors: [{ pointer: '/a', detail: 'd', code: 'c' }] })],
    [new InvalidQuery({ reason: 'r' })],
    [new InvalidEnvelope({ reason: 'r' })],
    [new Unauthenticated()],
    [new Forbidden()],
    [new NotFound({ entity: 'brand' })],
    [new DuplicateKey({ key: 'slug' })],
    [new Declined({ reason: 'r' })],
    [new Contention()],
    [new Overloaded({ retryAfterSeconds: 3 })],
    [new Unavailable({ dependency: 'mongo' })],
    [new UpstreamUnavailable({ upstream: 'catalog' })],
    [new Timeout({ dependency: 'mongo' })],
    [new ProtocolFailure({ reason: 'r', upstreamStatus: 500 })],
    [new Internal()],
    [new IdempotencyKeyMissing()],
    [new IdempotencyKeyReused()],
    [new IdempotencyKeyInFlight()],
  ])('%s round-trips through its problem body', failure => {
    const decoded = decodeProblem(problemOf(failure));

    expect(decoded._tag).toBe(failure._tag);
    expect(Schema.encodeUnknownSync(Schema.Unknown)(decoded)).toMatchObject(
      Object.fromEntries(Object.entries(failure)),
    );
  });

  it('answers the idempotency refusals with their decided statuses', () => {
    expect(problemOf(new IdempotencyKeyMissing()).status).toBe(400);
    expect(problemOf(new IdempotencyKeyReused()).status).toBe(422);
    expect(problemOf(new IdempotencyKeyInFlight()).status).toBe(409);
  });
});
