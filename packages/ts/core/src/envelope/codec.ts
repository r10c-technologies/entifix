import { Effect, Schema } from 'effect';

import { ProtocolFailure } from '../failure/generic.js';
import {
  lookupEvent,
  lookupMessage,
  type RegisteredMessage,
  registerMessage,
} from './registry.js';
import type {
  AudienceEntry,
  DomainEvent,
  EntifixEnvelope,
  EntifixEventMeta,
  EventEnvelope,
} from './types.js';

/**
 * A struct that keeps members it does not name: a newer peer's field is not
 * ours to drop. What a registered message schema should usually be, since a
 * plain `Schema.Struct` strips every unknown key on decode.
 */
export const openStruct = <S extends Schema.Struct.Fields>(fields: S) =>
  Schema.StructWithRest(Schema.Struct(fields), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]);

const AudienceEntrySchema = Schema.Struct({
  kind: Schema.Literals(['organization', 'party', 'flow']),
  id: Schema.String,
  digest: Schema.optional(Schema.String),
});

const EventMetaSchema = openStruct({
  name: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  at: Schema.NonEmptyString,
  correlationId: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Int),
  audience: Schema.optional(Schema.Array(AudienceEntrySchema)),
});

const LinkSchema = Schema.Struct({
  rel: Schema.String,
  href: Schema.String,
  method: Schema.optional(
    Schema.Literals(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  ),
});

const MetaSchema = openStruct({
  type: Schema.NonEmptyString,
  entity: Schema.optional(Schema.String),
  links: Schema.optional(Schema.mutable(Schema.Array(LinkSchema))),
  event: Schema.optional(EventMetaSchema),
});

const FrameSchema = Schema.Struct({
  meta: MetaSchema,
  data: Schema.Unknown,
});

/**
 * The envelope frame around one `data` schema — for a reader that knows the
 * one shape it accepts, such as a channel that only ever carries entity
 * changes, and so needs no registry lookup.
 */
export const Envelope = {
  codec: <A, I>(data: Schema.Codec<A, I>) =>
    Schema.Struct({ meta: MetaSchema, data }),
} as const;

const protocol = (reason: string) => new ProtocolFailure({ reason });

const describe = (error: { readonly message: string }): string =>
  error.message;

/** The registration a frame names: its `meta.type`, or its event name. */
const registrationFor = (meta: {
  readonly type: string;
  readonly event?: { readonly name: string } | undefined;
}): RegisteredMessage | string => {
  if (meta.type === 'event') {
    if (meta.event === undefined)
      return "an 'event' envelope carried no meta.event";
    return (
      lookupEvent(meta.event.name) ??
      `no schema is registered for event '${meta.event.name}'`
    );
  }
  return (
    lookupMessage(meta.type) ??
    `no schema is registered for message type '${meta.type}'`
  );
};

const checkRequirements = (
  registered: RegisteredMessage,
  event: EntifixEventMeta | undefined,
  direction: 'decode' | 'encode',
): string | undefined => {
  if (registered.versioned && event?.version === undefined)
    return `'${registered.name}' describes an aggregate version and carried none`;
  if (
    direction === 'encode' &&
    registered.kind === 'event' &&
    registered.audience === 'required' &&
    (event?.audience === undefined || event.audience.length === 0)
  )
    return `'${registered.name}' must name its audience; an empty one reaches nobody`;
  return undefined;
};

/**
 * Decodes an arbitrary body into an envelope whose `data` has been decoded
 * against the schema registered for it.
 *
 * Nothing is cast: a body that is not an envelope, names a type nothing
 * registered, or carries `data` its schema refuses fails with a
 * {@link ProtocolFailure} — poison on a bus, a dropped frame in a browser, a
 * typed failure at an HTTP client. `expected` narrows the accepted `meta.type`.
 */
export const decodeEnvelope = (
  body: unknown,
  expected?: string,
): Effect.Effect<EntifixEnvelope, ProtocolFailure> =>
  Effect.gen(function* () {
    const frame = yield* Schema.decodeUnknownEffect(FrameSchema)(body).pipe(
      Effect.mapError(error =>
        protocol(`the body is not an envelope: ${describe(error)}`),
      ),
    );
    if (expected !== undefined && frame.meta.type !== expected)
      return yield* Effect.fail(
        protocol(
          `expected an envelope of type '${expected}' but got '${frame.meta.type}'`,
        ),
      );
    const registered = registrationFor(frame.meta);
    if (typeof registered === 'string')
      return yield* Effect.fail(protocol(registered));
    const meta: EntifixEnvelope['meta'] = frame.meta;
    const unmet = checkRequirements(registered, meta.event, 'decode');
    if (unmet !== undefined) return yield* Effect.fail(protocol(unmet));
    const data = yield* Schema.decodeUnknownEffect(registered.schema)(
      frame.data,
    ).pipe(
      Effect.mapError(error =>
        protocol(
          `the data of '${registered.name}' does not decode: ${describe(error)}`,
        ),
      ),
    );
    return { meta, data };
  });

/**
 * Decodes a bus or stream message into a {@link DomainEvent}: an `event`
 * envelope whose metadata is complete and whose `data` decoded against its
 * registered schema.
 */
export const decodeEvent = <TData = unknown>(
  body: unknown,
): Effect.Effect<DomainEvent<TData>, ProtocolFailure> =>
  Effect.map(decodeEnvelope(body, 'event'), envelope => ({
    ...(envelope.meta.event as EntifixEventMeta),
    data: envelope.data as TData,
  }));

/**
 * Encodes an envelope for the wire: its `data` through the registered schema,
 * after checking what the registration requires of `meta` — a version on a
 * versioned message, an audience on an event that needs one. A publisher learns
 * here, at the write, that a message would be unreadable or undeliverable.
 */
export const encodeEnvelope = <TData>(
  envelope: EntifixEnvelope<TData>,
): Effect.Effect<EntifixEnvelope, ProtocolFailure> =>
  Effect.gen(function* () {
    const registered = registrationFor(envelope.meta);
    if (typeof registered === 'string')
      return yield* Effect.fail(protocol(registered));
    const unmet = checkRequirements(
      registered,
      envelope.meta.event,
      'encode',
    );
    if (unmet !== undefined) return yield* Effect.fail(protocol(unmet));
    const data = yield* Schema.encodeUnknownEffect(registered.schema)(
      envelope.data,
    ).pipe(
      Effect.mapError(error =>
        protocol(
          `the data of '${registered.name}' does not encode: ${describe(error)}`,
        ),
      ),
    );
    return { meta: envelope.meta, data };
  });

/** Frames a {@link DomainEvent} as an `event` envelope and encodes it. */
export const encodeEvent = <TData>(
  event: DomainEvent<TData>,
): Effect.Effect<EventEnvelope, ProtocolFailure> => {
  const { data, ...eventMeta } = event;
  return encodeEnvelope({
    meta: { type: 'event', event: eventMeta },
    data,
  }) as Effect.Effect<EventEnvelope, ProtocolFailure>;
};

/** Who may receive a message: one organization, one party, or one flow's holder. */
export interface AudienceRecipient {
  readonly organizationId?: string;
  readonly partyId?: string;
  /** The SHA-256 digest of a flow capability the recipient presented. */
  readonly flowDigests?: readonly string[];
}

/**
 * Whether `recipient` is in the message's audience.
 *
 * ⚠️ Fails closed: a message with no audience, or an empty one, admits nobody.
 * A stream that broadcast what nobody declared a recipient for would leak the
 * first event someone forgot to address.
 */
export const audienceAdmits = (
  audience: readonly AudienceEntry[] | undefined,
  recipient: AudienceRecipient,
): boolean =>
  (audience ?? []).some(entry => {
    switch (entry.kind) {
      case 'organization':
        return entry.id === recipient.organizationId;
      case 'party':
        return entry.id === recipient.partyId;
      case 'flow':
        return (
          entry.digest !== undefined &&
          (recipient.flowDigests ?? []).includes(entry.digest)
        );
    }
  });

// What core owns, and therefore registers. Every other shape is registered by
// the package that owns it.
const SerializedEntitySchema = Schema.Record(Schema.String, Schema.Unknown);

registerMessage('entity', SerializedEntitySchema);
registerMessage('entityCollection', Schema.Array(SerializedEntitySchema));
registerMessage(
  'entityPage',
  openStruct({
    items: Schema.Array(SerializedEntitySchema),
    total: Schema.Number,
    request: Schema.optionalKey(Schema.Unknown),
  }),
);
registerMessage(
  'entityMetadata',
  openStruct({
    actions: Schema.Array(Schema.Unknown),
    useCases: Schema.Array(Schema.Unknown),
  }),
);
registerMessage(
  'entityFacets',
  Schema.Record(
    Schema.String,
    Schema.Array(
      Schema.Struct({
        value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
        count: Schema.Number,
      }),
    ),
  ),
);

/** The `data` of an entity-change event, as a schema. */
export const EntityChangeEventSchema = Schema.Struct({
  entity: Schema.String,
  change: Schema.Literals(['created', 'updated', 'deleted']),
  id: Schema.Union([Schema.String, Schema.Number]),
});

/**
 * The one shape the browser's entity-change channel accepts: an `event`
 * envelope with complete `meta.event` and an entity change in `data`.
 */
export const EntityChangeEnvelope = Schema.Struct({
  meta: openStruct({
    type: Schema.Literal('event'),
    event: EventMetaSchema,
  }),
  data: EntityChangeEventSchema,
});


