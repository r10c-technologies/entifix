import {
  Contention,
  DuplicateKey,
  isFailure,
  isStoreFault,
  ProtocolFailure,
  type StoreFailure,
  type StoreFault,
  Timeout,
  Unavailable,
} from '@entifix/core';

/**
 * What a Mongo driver error means, as a categorised failure
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)).
 *
 * Read by **name, code and label**, never by class: the driver's error classes
 * are not what a consumer can match on, and a second copy of the driver in one
 * process would answer `instanceof` with `false`.
 */
export interface MongoErrorContext {
  /** What the failure names as its dependency; `mongo` when absent. */
  readonly dependency?: string;
  /**
   * What a duplicate key means here. On a declared uniqueness it is a
   * `conflict` — the caller asked for something that already exists. On a
   * claim or a race (an inbox, a command claim, a saga claim) it is
   * `contention` — someone else got there first, and retrying wins or replays.
   */
  readonly duplicate?: 'conflict' | 'contention';
}

interface DriverErrorShape {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly codeName?: unknown;
  readonly keyPattern?: unknown;
  readonly writeErrors?: ReadonlyArray<{ readonly code?: unknown }>;
  readonly errorLabels?: readonly string[];
  readonly hasErrorLabel?: (label: string) => boolean;
  readonly cause?: unknown;
}

const shape = (error: unknown): DriverErrorShape =>
  typeof error === 'object' && error !== null
    ? (error as DriverErrorShape)
    : {};

const labelled = (error: DriverErrorShape, label: string): boolean =>
  error.hasErrorLabel?.(label) ?? error.errorLabels?.includes(label) ?? false;

/** Whether a server label is on `error` or in its cause chain. */
export const mongoErrorLabelled = (error: unknown, label: string): boolean => {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (labelled(shape(current), label)) return true;
    current = shape(current).cause;
  }
  return false;
};

const DUPLICATE_KEY = 11000;
const WRITE_CONFLICT = 112;
const MAX_TIME_EXPIRED = 50;

const UNREACHABLE = new Set([
  'MongoNetworkError',
  'MongoServerSelectionError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
  'MongoServerClosedError',
  'MongoPoolClosedError',
]);

const isDuplicate = (error: DriverErrorShape): boolean =>
  error.code === DUPLICATE_KEY ||
  (error.writeErrors?.some(write => write.code === DUPLICATE_KEY) ?? false);

const duplicatedKey = (error: DriverErrorShape): string | undefined =>
  typeof error.keyPattern === 'object' && error.keyPattern !== null
    ? Object.keys(error.keyPattern).join(',')
    : undefined;

export const translateMongoError = (
  error: unknown,
  context: MongoErrorContext = {},
): StoreFailure => {
  // Already translated, by an inner call: pass it through as it is.
  if (isFailure(error)) return error as StoreFailure;
  const dependency = context.dependency ?? 'mongo';
  const driver = shape(error);

  if (isDuplicate(driver)) {
    if (context.duplicate === 'contention') return new Contention();
    const key = duplicatedKey(driver);
    return new DuplicateKey(key === undefined ? {} : { key });
  }
  if (
    driver.code === WRITE_CONFLICT ||
    mongoErrorLabelled(error, 'TransientTransactionError')
  )
    return new Contention();
  if (
    driver.code === MAX_TIME_EXPIRED ||
    driver.name === 'MongoNetworkTimeoutError' ||
    driver.name === 'MongoOperationTimeoutError'
  )
    return new Timeout({ dependency });
  if (driver.name === 'BSONError')
    return new ProtocolFailure({
      reason: `${dependency} answered a document that does not decode`,
    });
  if (typeof driver.name === 'string' && UNREACHABLE.has(driver.name))
    return new Unavailable({ dependency });
  // Anything else the driver raised is still the store failing to answer,
  // which is what the class tree called every one of these.
  return new Unavailable({ dependency });
};

/**
 * A driver error as the store's own fault, for the bookkeeping a mechanism
 * does around a caller's work — a claim, a commit, a remembered answer. A
 * duplicate key there means a race lost, never an answer for the caller.
 */
export const translateMongoFault = (
  error: unknown,
  context: Omit<MongoErrorContext, 'duplicate'> = {},
): StoreFault => {
  const failure = translateMongoError(error, {
    ...context,
    duplicate: 'contention',
  });
  return isStoreFault(failure) ? failure : new Contention();
};
