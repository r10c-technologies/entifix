import { type DomainEvent, registerEvent } from '@entifix/core';
import {
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schema,
  Scope,
  Stream,
} from 'effect';
import { TestClock } from 'effect/testing';
import { beforeAll, describe, expect, it } from 'vitest';

import { makeServerPush, ServerPushTag } from './server-push.js';
import {
  makeSsePush,
  PUSH_HEARTBEAT,
  type SsePush,
  type SsePushConnection,
  type SsePushDials,
} from './sse.js';

const NAME = 'push-spec.thing.changed';

beforeAll(() => {
  registerEvent(NAME, Schema.Struct({ topic: Schema.String }));
});

const event = (id: string, topic = 'entity:x'): DomainEvent => ({
  name: NAME,
  id,
  source: 'spec',
  at: '2026-11-02T00:00:00.000Z',
  correlationId: id,
  audience: [{ kind: 'organization', id: 'a' }],
  data: { topic },
});

const connection = (
  overrides: Partial<SsePushConnection> = {},
): SsePushConnection => ({
  recipient: { organizationId: 'a' },
  topics: ['entity:x'],
  ...overrides,
});

const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] as number;
};

const DIALS: SsePushDials = {
  retryMs: { min: 1_000, max: 11_000 },
  reauthMarginMs: 30_000,
  random: sequence(0.5),
};

const framesOf = (response: ReturnType<SsePush['respond']>) => {
  const body = response.body;
  /* v8 ignore next 3 -- `respond` always builds a stream body; this narrows
     the `HttpBody` union rather than guarding a reachable case. */
  if (body._tag !== 'Stream') {
    throw new Error(`expected a stream body, got ${body._tag}`);
  }
  return Stream.map(body.stream, (bytes: Uint8Array) =>
    new TextDecoder().decode(bytes),
  );
};

/** A push hub and its SSE adapter, built in `scope`. */
const build = (scope: Scope.Scope, dials: SsePushDials = DIALS) =>
  Effect.gen(function* () {
    const push = yield* makeServerPush({
      topicsOf: e => [(e.data as { topic: string }).topic],
    });
    const sse = yield* makeSsePush(dials).pipe(
      Effect.provide(Layer.succeed(ServerPushTag, push)),
    );
    return { push, sse };
  }).pipe(Scope.provide(scope));

/** Lets forked readers start and subscribe before the clock moves. */
const settle = Effect.forEach(
  Array.from({ length: 50 }),
  () => Effect.yieldNow,
  {
    discard: true,
  },
);

const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(
    Effect.orDie(effect).pipe(Effect.provide(TestClock.layer())),
  );

/** Reads the first `count` frames of one connection after `act` runs. */
const firstFrames = (
  count: number,
  act: (built: {
    push: { publish: (e: DomainEvent) => Effect.Effect<void> };
  }) => Effect.Effect<void>,
  conn: SsePushConnection = connection(),
  dials?: SsePushDials,
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const built = yield* build(scope, dials);
    const reading = yield* Effect.forkChild(
      Stream.runCollect(Stream.take(framesOf(built.sse.respond(conn)), count)),
    );
    yield* settle;
    yield* act(built);
    const frames = yield* Fiber.join(reading);
    yield* Scope.close(scope, Exit.void);
    return Array.from(frames);
  });

describe('makeSsePush', () => {
  it('answers text/event-stream, uncacheable and unbuffered', async () => {
    const headers = await run(
      Effect.scoped(
        Effect.flatMap(Effect.scope, scope =>
          Effect.map(
            build(scope),
            ({ sse }) => sse.respond(connection()).headers,
          ),
        ),
      ),
    );
    expect(headers['content-type']).toBe('text/event-stream');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-accel-buffering']).toBe('no');
  });

  it('opens at once with a retry drawn from the dial range', async () => {
    const frames = await run(firstFrames(1, () => Effect.void));
    expect(frames).toEqual(['retry: 6000\n: open\n\n']);
  });

  it('draws a different retry for each connection', async () => {
    const retries = await run(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const { sse } = yield* build(scope, {
          ...DIALS,
          random: sequence(0.1, 0.9),
        });
        const first = (c: SsePushConnection) =>
          Stream.runHead(framesOf(sse.respond(c)));
        const a = yield* first(connection());
        const b = yield* first(connection());
        yield* Scope.close(scope, Exit.void);
        return [a, b];
      }),
    );
    expect(retries.map(r => r._tag === 'Some' && r.value)).toEqual([
      'retry: 2000\n: open\n\n',
      'retry: 10000\n: open\n\n',
    ]);
  });

  it(`sends a heartbeat every ${Duration.toSeconds(PUSH_HEARTBEAT)} s while idle`, async () => {
    const frames = await run(
      firstFrames(3, () => TestClock.adjust(Duration.times(PUSH_HEARTBEAT, 2))),
    );
    expect(frames.slice(1)).toEqual([': heartbeat\n\n', ': heartbeat\n\n']);
  });

  it('frames an event with its id, and drops one that does not encode', async () => {
    const frames = await run(
      firstFrames(2, ({ push }) =>
        Effect.andThen(
          push.publish({ ...event('bad'), name: 'push-spec.unregistered' }),
          push.publish(event('e1')),
        ),
      ),
    );
    expect(frames[1]).toMatch(/^id: e1\ndata: \{"meta":\{"type":"event"/);
    expect(frames[1]).toContain('"data":{"topic":"entity:x"}');
  });

  it('asks a reconnect to resync when the host has no catch-up', async () => {
    const frames = await run(
      firstFrames(2, () => Effect.void, connection({ cursor: 'e0' })),
    );
    expect(frames[1]).toBe('event: resync\ndata: {"topics":["entity:x"]}\n\n');
  });

  it('asks for a reauth before exp, then closes and sends nothing more', async () => {
    // exp at 120 s with a 30 s margin: the reauth is due at 90 s, after five
    // heartbeats and before the sixth.
    const frames = await run(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const { push, sse } = yield* build(scope);
        const reading = yield* Effect.forkChild(
          Stream.runCollect(
            framesOf(sse.respond(connection({ expiresAt: 120 }))),
          ),
        );
        yield* settle;
        yield* TestClock.adjust('90 seconds');
        const frames = yield* Fiber.join(reading);
        yield* push.publish(event('late'));
        yield* Scope.close(scope, Exit.void);
        return Array.from(frames);
      }),
    );
    expect(frames.at(-1)).toBe('event: reauth\ndata: {}\n\n');
    expect(frames.filter(f => f === ': heartbeat\n\n')).toHaveLength(5);
    expect(frames.join('')).not.toContain('late');
  });

  it('reauths at once for a token already inside its margin', async () => {
    const frames = await run(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const { sse } = yield* build(scope);
        const frames = yield* Stream.runCollect(
          framesOf(sse.respond(connection({ expiresAt: 1 }))),
        );
        yield* Scope.close(scope, Exit.void);
        return Array.from(frames);
      }),
    );
    expect(frames).toEqual([
      'retry: 6000\n: open\n\n',
      'event: reauth\ndata: {}\n\n',
    ]);
  });

  it('drains every open connection with a fresh retry when its scope closes', async () => {
    const endings = await run(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const { sse } = yield* build(scope, {
          ...DIALS,
          random: sequence(0, 0.2, 0.4, 0.6),
        });
        const read = () =>
          Effect.forkChild(
            Stream.runCollect(framesOf(sse.respond(connection()))),
          );
        const a = yield* read();
        const b = yield* read();
        yield* TestClock.adjust('1 millis');
        yield* Scope.close(scope, Exit.void);
        return [
          Array.from(yield* Fiber.join(a)).at(-1),
          Array.from(yield* Fiber.join(b)).at(-1),
        ];
      }),
    );
    expect(endings).toEqual(['retry: 5000\n\n', 'retry: 7000\n\n']);
  });

  it('stops waiting on a drain after its window', async () => {
    const closed = await run(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const { sse } = yield* build(scope, { ...DIALS, drainWindowMs: 100 });
        // A connection nobody reads: its last frame is never pulled.
        yield* Effect.forkChild(
          Stream.runDrain(
            Stream.take(framesOf(sse.respond(connection())), 1).pipe(
              Stream.concat(Stream.never),
            ),
          ),
        );
        yield* TestClock.adjust('1 millis');
        const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
        yield* TestClock.adjust('100 millis');
        yield* Fiber.join(closing);
        return true;
      }),
    );
    expect(closed).toBe(true);
  });

  it('ends with its source and adds no closing frame of its own', async () => {
    const frames = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const sse = yield* makeSsePush(DIALS).pipe(
            Effect.provide(
              Layer.succeed(ServerPushTag, {
                publish: () => Effect.void,
                open: () =>
                  Stream.make({ _tag: 'resync', topics: ['entity:x'] }),
              }),
            ),
          );
          return Array.from(
            yield* Stream.runCollect(framesOf(sse.respond(connection()))),
          );
        }),
      ),
    );
    expect(frames).toEqual([
      'retry: 6000\n: open\n\n',
      'event: resync\ndata: {"topics":["entity:x"]}\n\n',
    ]);
  });
});
