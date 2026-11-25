import type { EntityAction } from '../../types/EntityAction.js';
import type { UseCaseDescriptor } from '../describe/describe-entity-use-cases.js';
import type { EntityStateRules } from '../describe/entity-state-rules.js';

/**
 * What a caller may do with one entity, as answered by
 * `GET /api/<entity>/$metadata`.
 *
 * Both members are **already filtered against the verified principal** — the
 * service computes them through `PolicyDecisionTag`, so this is not a catalogue
 * of everything the model declares but of what this caller is permitted. A UI
 * renders it directly; it never re-checks, and it has nothing to re-check with.
 *
 * `actions` is here beside `useCases` because Save and Delete are the three most
 * common affordances on any screen and they have no descriptor — without them a
 * form would keep rendering its buttons unconditionally and the document would
 * describe only the rare half of the surface.
 */
/**
 * It also carries the entity's {@link EntityStateRules} — the states a record
 * must hold for Save and Delete to be offered on it — which are the model's,
 * not the caller's, and are absent on an entity that declares none.
 */
export interface EntityMetadataDocument extends EntityStateRules {
  /** The CRUD subset this caller holds, in {@link ENTITY_ACTIONS} order. */
  actions: EntityAction[];
  /** The declared use cases this caller may invoke, in declaration order. */
  useCases: UseCaseDescriptor[];
}
