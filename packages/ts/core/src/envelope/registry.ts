import { Schema } from 'effect';

/**
 * What a registered message requires of its `meta`, beside its `data` schema.
 *
 * - `versioned` — the message describes one version of one aggregate, so it
 *   must carry `meta.event.version`; a consumer discards anything older than
 *   what it already applied.
 * - `audience` — `required` (the default) means the message must name who may
 *   receive it, because an empty audience reaches nobody; `none` declares a
 *   message nobody outside the fleet ever receives, such as an announcement
 *   folded into a projection anyone may read.
 */
export interface MessageRequirements {
  readonly versioned?: boolean;
  readonly audience?: 'required' | 'none';
}

/** One registration: the schema `data` decodes against, plus its requirements. */
export interface RegisteredMessage {
  /** The `meta.type`, or the event name for an `event`. */
  readonly name: string;
  readonly kind: 'type' | 'event';
  readonly schema: Schema.Codec<unknown, unknown>;
  readonly versioned: boolean;
  readonly audience: 'required' | 'none';
}

/**
 * Shared through `globalThis` under a registered symbol, for the reason the
 * failure registry is: two copies of `@entifix/core` in one process would
 * otherwise hold two tables, and a schema registered against one would not
 * decode through the other.
 */
const REGISTRY_KEY = Symbol.for('@entifix/core/message-registry');

interface Registry {
  readonly types: Map<string, RegisteredMessage>;
  readonly events: Map<string, RegisteredMessage>;
}

const registry = (): Registry => {
  const holder = globalThis as { [REGISTRY_KEY]?: Registry };
  holder[REGISTRY_KEY] ??= { types: new Map(), events: new Map() };
  return holder[REGISTRY_KEY];
};

/**
 * A structural fingerprint of a schema, so a module evaluated twice — a hot
 * reload, a test re-importing — registers an equal schema object without
 * tripping the duplicate check.
 */
const fingerprint = (schema: Schema.Codec<unknown, unknown>): string =>
  JSON.stringify(Schema.toJsonSchemaDocument(schema));

const register = (
  table: Map<string, RegisteredMessage>,
  entry: RegisteredMessage,
): void => {
  const existing = table.get(entry.name);
  if (
    existing !== undefined &&
    (fingerprint(existing.schema) !== fingerprint(entry.schema) ||
      existing.versioned !== entry.versioned ||
      existing.audience !== entry.audience)
  )
    throw new Error(
      `message '${entry.name}' is already registered with a different schema. ` +
        'A name means one shape on every transport: give this one its own name, ' +
        'or bump the existing one.',
    );
  table.set(entry.name, entry);
};

const entry = (
  name: string,
  kind: RegisteredMessage['kind'],
  schema: Schema.Codec<unknown, unknown>,
  requirements: MessageRequirements,
): RegisteredMessage => ({
  name,
  kind,
  schema,
  versioned: requirements.versioned ?? false,
  audience: requirements.audience ?? 'required',
});

/**
 * Registers the schema an envelope of `meta.type === type` carries in `data`.
 * Called at module load by the package that owns the shape; a second call with
 * a different schema throws.
 */
export const registerMessage = <A, I>(
  type: string,
  schema: Schema.Codec<A, I>,
  requirements: MessageRequirements = {},
): void =>
  register(
    registry().types,
    entry(
      type,
      'type',
      schema as unknown as Schema.Codec<unknown, unknown>,
      requirements,
    ),
  );

/**
 * Registers the schema an `event` envelope named `name` carries in `data`,
 * and what its `meta.event` must state.
 */
export const registerEvent = <A, I>(
  name: string,
  schema: Schema.Codec<A, I>,
  requirements: MessageRequirements = {},
): void =>
  register(
    registry().events,
    entry(
      name,
      'event',
      schema as unknown as Schema.Codec<unknown, unknown>,
      requirements,
    ),
  );

/** The registration for a `meta.type`, if any package made one. */
export const lookupMessage = (type: string): RegisteredMessage | undefined =>
  registry().types.get(type);

/** The registration for an event name, if any package made one. */
export const lookupEvent = (name: string): RegisteredMessage | undefined =>
  registry().events.get(name);

/** Every registered event, ordered by name — what a register check walks. */
export const registeredEvents = (): readonly RegisteredMessage[] =>
  [...registry().events.values()].sort((a, b) => a.name.localeCompare(b.name));

/** Every registered `meta.type`, ordered by name. */
export const registeredMessages = (): readonly RegisteredMessage[] =>
  [...registry().types.values()].sort((a, b) => a.name.localeCompare(b.name));
