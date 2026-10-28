import type {
  FailureCategory,
  FailureClass,
  FailureFamily,
} from './failure.js';

/** One registered failure: what a wire `code` decodes back into. */
export interface RegisteredFailure {
  readonly code: string;
  readonly tag: string;
  readonly category: FailureCategory;
  readonly family: FailureFamily;
  /** The RFC 9457 `type` URI. */
  readonly type: string;
  readonly failureClass: FailureClass;
}

/**
 * The registry is shared through `globalThis` under a registered symbol, not
 * held in a module-level `Map`.
 *
 * ⚠️ Two copies of `@entifix/core` in one process — a bundler that duplicated
 * it, a consumer's own pin beside a dependency's — would otherwise hold two
 * registries, and a failure defined against one would not decode through the
 * other. One table per process is the property the bus relies on when it
 * decodes a failure a second module instance defined.
 */
const REGISTRY_KEY = Symbol.for('@entifix/core/failure-registry');

type Registry = Map<string, RegisteredFailure>;

const registry = (): Registry => {
  const holder = globalThis as { [REGISTRY_KEY]?: Registry };
  holder[REGISTRY_KEY] ??= new Map();
  return holder[REGISTRY_KEY];
};

/** The RFC 9457 `type` a code answers with. */
export const failureTypeUri = (code: string): string =>
  `urn:entifix:failure:${code}`;

/**
 * Record a failure's code. A code is permanent (AIP-193): it never changes
 * meaning and is never reused, so a second **tag** claiming one throws here,
 * at module load, rather than putting two meanings on one wire.
 *
 * The same tag registering the same code again replaces the entry. That is a
 * module evaluated twice — a dev server's hot reload, a test re-importing —
 * and refusing it would turn every reload into a boot failure.
 */
export const registerFailure = (entry: RegisteredFailure): void => {
  const existing = registry().get(entry.code);
  if (existing !== undefined && existing.tag !== entry.tag)
    throw new Error(
      `failure code '${entry.code}' is already registered by '${existing.tag}', ` +
        `and '${entry.tag}' cannot claim it. A code is permanent and names ` +
        'one failure: give this one its own.',
    );
  registry().set(entry.code, entry);
};

/** The failure a code names, if anything registered it. */
export const lookupFailure = (code: string): RegisteredFailure | undefined =>
  registry().get(code);

/** Every registered failure, ordered by code. */
export const registeredFailures = (): readonly RegisteredFailure[] =>
  [...registry().values()].sort((a, b) => a.code.localeCompare(b.code));
