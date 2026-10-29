import type { EntityMetadataDocument } from '../entity-definition/metadata/index.js';
import type { SerializedEntity } from '../entity-definition/serializer/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import type { EntityFacetCounts } from '../types/EntityFacets.js';
import type { EntityLoadRequest } from '../types/EntityLoadRequest.js';

/**
 * Names what {@link EntifixEnvelope.data} carries — a name in the open message
 * registry (`registerMessage`), not a member of a closed union.
 *
 * Core registers only what core owns: `entity`, `entityCollection`,
 * `entityPage`, `entityMetadata`, `entityFacets`, and `event`, whose `data` is
 * looked up by `meta.event.name` instead (`registerEvent`). Every other shape is
 * registered by the package that owns it — `@entifix/transactions` registers
 * `command` and its accept, record and saga shapes — so adding a kind of message
 * never means changing core.
 *
 * A read never trusts the name: `decodeEnvelope` decodes `data` against the
 * registered schema, and an unregistered name is a protocol failure.
 */
export type EntifixEnvelopeType = string;

export type EntifixEnvelopeMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A HATEOAS affordance: where the peer can go next from this message. Optional —
 * the envelope stands on its own without links, and only the artifact that owns
 * a route surface (today the REST service) is able to fill them in.
 */
export interface EntifixEnvelopeLink {
  rel: string;
  href: string;
  method?: EntifixEnvelopeMethod;
}

/**
 * The facts a message carries about *itself*, as opposed to about what
 * happened. Present only when the envelope is a bus message.
 *
 * The split rule: `meta` describes the message, `data` describes the
 * occurrence. So `correlationId` belongs here and an outcome's `code` does not.
 *
 * **`source` is never a consumer branch.** It is there for routing,
 * observability and audit. A handler that behaves differently depending on who
 * published re-couples the two services the bus decoupled — which is why .NET's
 * canonical `(sender, eventArgs)` types its sender as bare `object`, making the
 * dependency awkward on purpose. TypeScript cannot reproduce that friction, so
 * here it is a rule rather than a type.
 */
export interface EntifixEventMeta {
  /**
   * What happened, in the register's vocabulary: `catalog.published`,
   * `transaction.completed`. Declared in `tools/slices/*.slice.ts` as
   * `publishedEvents`/`subscriptions`, and used verbatim as the AMQP routing
   * key — which is what makes a subscriber's declared interest and its actual
   * queue binding the same string.
   */
  name: string;
  /**
   * Unique per message, and **the** deduplication key. Delivery is
   * at-least-once, so a consumer that must not fold twice keys on this.
   *
   * Not `correlationId`: one flow emits several messages, so correlating and
   * deduplicating are different questions. Keying dedup on the correlation id
   * makes a transaction's `completed` look like a duplicate of its `accepted`.
   */
  id: string;
  /** The emitting **slice** — the unit that owns a store — e.g. `catalog`. */
  source: string;
  /** ISO-8601 emission time. */
  at: string;
  /** Ties every message of one flow together — a transaction id, a flow id. */
  correlationId?: string;
  /**
   * The version of the aggregate this message describes. Required on a
   * message registered `versioned`, and what a consumer orders on: one that
   * already applied version `n` discards a late `n - 1` instead of letting it
   * overwrite (`discardIfStale`).
   */
  version?: number;
  /**
   * Who may receive this message. Absent or empty, it reaches **nobody** —
   * `audienceAdmits` fails closed, so a publisher that forgot to address a
   * message leaks nothing.
   */
  audience?: readonly AudienceEntry[];
}

/**
 * One recipient of a message: every member of an organization, one party, or
 * whoever holds a flow's capability — whose SHA-256 digest is `digest`, so the
 * audience never carries the credential itself.
 */
export interface AudienceEntry {
  kind: 'organization' | 'party' | 'flow';
  id: string;
  digest?: string;
}

export interface EntifixEnvelopeMeta {
  type: EntifixEnvelopeType;
  /**
   * The target entity's `key` (falling back to its class name).
   *
   * Optional, because a bus message need not be about an entity at all —
   * `settlement.run.completed` is about a run. What a message *is* lives in
   * {@link EntifixEventMeta.name}; this stays the entity label the HTTP arm
   * routes on.
   */
  entity?: string;
  links?: EntifixEnvelopeLink[];
  /** Present only on a bus message. */
  event?: EntifixEventMeta;
}

/**
 * One message on the bus: its own metadata, plus the payload describing what
 * happened.
 *
 * Generic in the payload so a publisher keeps its own shape —
 * `DomainEvent<TransactionEvent>` today, `DomainEvent<PublishedOffering>` when
 * a projection's event lands — without the transport learning either.
 */
export interface DomainEvent<TData = unknown> extends EntifixEventMeta {
  data: TData;
}

/**
 * A change to an entity that happened on the server, delivered out-of-band —
 * the `data` of a bus/stream `event` envelope rather than a framing of its own
 *. `entity` is the `key ?? name` an adapter routes on, the same
 * string `entityQueryScope` uses, so a subscriber can invalidate exactly the
 * affected query keys.
 *
 * It lives in core rather than beside the React `ReactiveChannel` that consumes
 * it because both ends need it: the service maps a `TransactionEvent` onto it,
 * and the React packages sit above every tier that does the mapping.
 *
 * Deliberately **no** `transactionId`, timestamp or sequence: all three already
 * exist one level up as `meta.event.correlationId`, `.at` and `.id`, and
 * duplicating them onto the payload is how two sources of the same fact drift.
 */
export interface EntityChangeEvent {
  entity: string;
  change: 'created' | 'updated' | 'deleted';
  id: EntityId;
}

/**
 * The standard message exchanged between entifix artifacts.
 *
 * Every request and response body is an envelope: `meta` describes the payload,
 * `data` is the payload. It is deliberately transport-free — it lives in `core`
 * and knows nothing about HTTP — so the same contract can carry entities over
 * REST today and amqp or websockets later.
 */
export interface EntifixEnvelope<TData = unknown> {
  meta: EntifixEnvelopeMeta;
  data: TData;
}

/**
 * `data` shape when `meta.type` is `entityPage`. Generic in the entity so the
 * echoed `request` keeps its `keyof TEntity` filter/sort types — `EntityLoadRequest`
 * is invariant in its entity, so a non-generic `EntityLoadRequest<Entity>` here
 * would not accept a caller's `EntityLoadRequest<Product>`.
 */
export interface SerializedEntityPage<TEntity extends Entity = Entity> {
  items: SerializedEntity[];
  total: number;
  request?: EntityLoadRequest<TEntity>;
}

export type EntityEnvelope = EntifixEnvelope<SerializedEntity>;
export type EntityCollectionEnvelope = EntifixEnvelope<SerializedEntity[]>;
export type EntityPageEnvelope<TEntity extends Entity = Entity> =
  EntifixEnvelope<SerializedEntityPage<TEntity>>;
export type EntityMetadataEnvelope = EntifixEnvelope<EntityMetadataDocument>;
export type EntityFacetsEnvelope = EntifixEnvelope<EntityFacetCounts>;

/**
 * A bus message on the wire. `meta.event` is always populated, and
 * `decodeEvent` is what proves it before a consumer sees the payload.
 */
export type EventEnvelope<TData = unknown> = EntifixEnvelope<TData> & {
  meta: EntifixEnvelopeMeta & { event: EntifixEventMeta };
};
