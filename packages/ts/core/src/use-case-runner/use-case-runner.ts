import type { Effect } from 'effect';

import type { UseCaseDescriptor } from '../entity-definition/describe/describe-entity-use-cases.js';
import type { UseCaseBinding } from '../entity-definition/meta-entities/meta-use-case/meta-use-case.js';
import type { TransitionalFailure } from '../failure/failure.js';
import type { BulkOutcome } from '../types/BulkOutcome.js';
import type { Entity, EntityId } from '../types/Entity.js';
import type { EntitySelection } from '../types/EntitySelection.js';

/**
 * The path a verb is served at, from its entity's key, its own key and its
 * binding
 * ([ADR 0020](../../../../../docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)):
 * a verb on one record is `POST /api/<entity>/:id/<verb>`, one on a selection
 * or on nothing is `POST /api/<entity>/<verb>`. The shell serves it there and a
 * client calls it there, so the two cannot disagree.
 */
export const verbPath = (
  entityKey: string,
  useCaseKey: string,
  binding: UseCaseBinding,
): `/${string}` =>
  binding === 'entity'
    ? `/api/${entityKey}/:id/${useCaseKey}`
    : `/api/${entityKey}/${useCaseKey}`;

/**
 * Runs an entity's verbs for a screen — over REST against the service that
 * serves them, or in-process for a host whose records live in the browser.
 * Chosen at composition, the way a repository is, so a generated screen runs
 * a verb without knowing which.
 */
export interface EntityUseCaseRunner {
  /** Runs a verb on one record, or on nothing for an unbound verb. */
  run(
    useCase: UseCaseDescriptor,
    id?: EntityId,
  ): Effect.Effect<void, TransitionalFailure>;
  /** Runs a collection verb on a selection, one outcome per record. */
  bulk(
    useCase: UseCaseDescriptor,
    selection: EntitySelection<Entity>,
  ): Effect.Effect<readonly BulkOutcome[], TransitionalFailure>;
}
