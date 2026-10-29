import { Effect } from 'effect';

import type { EntityMetadataDocument } from '../entity-definition/metadata/index.js';
import {
  deserializeEntityCollection,
  deserializeSingleEntity,
} from '../entity-definition/serializer/index.js';
import { InvalidEnvelope } from '../failure/generic.js';
import type { Entity, EntityConstructor } from '../types/Entity.js';
import type { EntityFacetCounts } from '../types/EntityFacets.js';
import type { EntityPage } from '../types/EntityPage.js';
import { decodeEnvelope } from './codec.js';
import { envelopeEntityName } from './make-envelope.js';
import type {
  EntifixEnvelope,
  EntifixEnvelopeType,
  SerializedEntityPage,
} from './types.js';

/**
 * Decodes a body a **caller sent** — a request to this service — into an
 * envelope of the expected type, its `data` decoded against the registered
 * schema.
 *
 * The same decode as {@link decodeEnvelope}, failing with an
 * {@link InvalidEnvelope} instead of a protocol failure: a malformed request is
 * the sender's fault and answers `400`, where a peer's malformed *answer* is a
 * `502`.
 */
export const decodeRequestEnvelope = (
  body: unknown,
  expected: EntifixEnvelopeType,
  label = 'message',
): Effect.Effect<EntifixEnvelope, InvalidEnvelope> =>
  Effect.mapError(
    decodeEnvelope(body, expected),
    failure =>
      new InvalidEnvelope({
        reason: `"${label}": ${failure.reason}`,
      }),
  );

const decodeFor = <TEntity extends Entity, TData>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
  expected: EntifixEnvelopeType,
): Effect.Effect<EntifixEnvelope<TData>, InvalidEnvelope> =>
  decodeRequestEnvelope(
    body,
    expected,
    envelopeEntityName(entityConstructor),
  ) as Effect.Effect<EntifixEnvelope<TData>, InvalidEnvelope>;

export const readEntityEnvelope = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
) =>
  Effect.gen(function* () {
    const envelope = yield* decodeFor<TEntity, unknown>(
      entityConstructor,
      body,
      'entity',
    );
    // The registered schema already refused a missing or non-object `data`,
    // so the deserializer always has a record to build from.
    return (yield* deserializeSingleEntity(
      entityConstructor,
      envelope.data,
    )) as TEntity;
  });

export const readEntityCollectionEnvelope = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
) =>
  Effect.gen(function* () {
    const envelope = yield* decodeFor<TEntity, unknown>(
      entityConstructor,
      body,
      'entityCollection',
    );
    const items = yield* deserializeEntityCollection(
      entityConstructor,
      envelope.data,
    );
    return items as TEntity[];
  });

export const readEntityPageEnvelope = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
) =>
  Effect.gen(function* () {
    const envelope = yield* decodeFor<TEntity, SerializedEntityPage<TEntity>>(
      entityConstructor,
      body,
      'entityPage',
    );
    const items = yield* deserializeEntityCollection(
      entityConstructor,
      envelope.data.items,
    );
    return {
      items: items as TEntity[],
      total: envelope.data.total,
      request: envelope.data.request ?? {},
    } satisfies EntityPage<TEntity>;
  });

/**
 * Reads a `$metadata` response back into its document.
 *
 * No defaulting of the members: the registered schema refuses a document
 * missing either list, so a form never has to guess whether "no actions" meant
 * "denied" or "malformed".
 */
export const readEntityMetadataEnvelope = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
) =>
  Effect.map(
    decodeFor<TEntity, EntityMetadataDocument>(
      entityConstructor,
      body,
      'entityMetadata',
    ),
    envelope => envelope.data,
  );

/**
 * Reads a `$facets` response back into its counts. The registered schema
 * refuses a body whose lists are not `{ value, count }` rows — a panel that
 * rendered a malformed count would show a number nobody computed.
 */
export const readEntityFacetsEnvelope = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  body: unknown,
) =>
  Effect.map(
    decodeFor<TEntity, EntityFacetCounts>(
      entityConstructor,
      body,
      'entityFacets',
    ),
    envelope => envelope.data,
  );
