import { randomUUID } from 'node:crypto';

import { Contention } from '@entifix/core';
import { type LockService, LockServiceTag } from '@entifix/transactions';
import { Duration, Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';

import { translateRedisError } from '../errors/translate-redis-error.js';
import { RedisTag } from '../redis-connection/redis-connection.js';

/** How long a held lock survives without renewal — bounds a crashed holder. */
export const LOCK_TTL_MS = 5_000;
/** Bounded retry budget so contention fails fast rather than hanging. */
export const LOCK_RETRIES = 20;
export const LOCK_RETRY_DELAY_MS = 100;

/**
 * Compare-and-delete so a release only frees the caller's own lock — never one
 * a later holder acquired after this one's TTL lapsed.
 */
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/**
 * Redis-backed {@link LockService}: `SET key token NX PX ttl` with bounded
 * retry. The `NX` flag makes acquisition atomic across instances.
 */
export const makeRedisLockService = (redis: Redis): LockService => ({
  acquire: key =>
    Effect.gen(function* () {
      const token = randomUUID();
      for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
        const result = yield* Effect.tryPromise({
          try: () => redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX'),
          catch: error => translateRedisError(error),
        });
        if (result === 'OK') {
          return { key, token };
        }
        yield* Effect.sleep(Duration.millis(LOCK_RETRY_DELAY_MS));
      }
      return yield* Effect.fail(new Contention());
    }),
  release: handle =>
    Effect.tryPromise({
      try: () => redis.eval(RELEASE_SCRIPT, 1, handle.key, handle.token),
      catch: error => translateRedisError(error),
    }).pipe(Effect.asVoid),
});

/** Provides {@link LockServiceTag} from a {@link RedisTag} connection. */
export const RedisLockServiceLayer = Layer.effect(
  LockServiceTag,
  Effect.map(RedisTag, makeRedisLockService),
);
