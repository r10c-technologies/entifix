// Registers the declared verbs on `Invoice`. Importing is the act — and the
// domain package is `sideEffects: true`, or a bundler drops the `@useCase`
// classes nothing names and every verb silently disappears.
import '@entifix/example-workspace-domain';

import {
  describeEntityUseCases,
  type EntityMetadataSource,
} from '@entifix/core';

/**
 * What a caller may do with each entity, answered locally.
 *
 * A served application asks `GET /api/<entity>/$metadata`, and the service
 * filters the answer by the verified principal — that filter is the point of
 * the document. There is no principal here, so every action is allowed and the
 * use cases are read straight off the entity's declarations — unless the
 * {@link VIEWER_COOKIE} is set. The screens cannot
 * tell the difference: they only ever see an `EntityMetadataDocument`.
 */
/**
 * The cookie that makes the reader a viewer: an e2e journey sets it to stand in
 * for a principal who holds only `read`, the way a served `$metadata` would
 * answer for one.
 */
export const VIEWER_COOKIE = 'example-role=viewer';

const isViewer = (): boolean =>
  typeof document !== 'undefined' &&
  document.cookie.split('; ').includes(VIEWER_COOKIE);

export const metadataSource: EntityMetadataSource = {
  fetchMetadata: async entityConstructor =>
    isViewer()
      ? { actions: ['read'], useCases: [] }
      : {
          actions: ['read', 'write', 'delete'],
          useCases: describeEntityUseCases(entityConstructor),
        },
};
