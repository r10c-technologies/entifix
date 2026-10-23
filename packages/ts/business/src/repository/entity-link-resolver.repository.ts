import {
  type EntifixError,
  EntifixLogicError,
  type Entity,
  type EntityConstructor,
  type EntityLinkResolver,
} from '@entifix/core';
import { Context, Effect } from 'effect';

import { EntityRepositoryTag } from './entity.repository.js';

/**
 * DI tag for the {@link EntityLinkResolver} an environment provides so entity
 * links can materialize their targets. The composition root supplies a resolver
 * backed by the appropriate adapters (REST on the web, Mongo on the backend),
 * and use-cases that follow links yield this tag rather than depending on any
 * concrete repository.
 */
export class EntityLinkResolverTag extends Context.Service<
  EntityLinkResolverTag,
  EntityLinkResolver
>()('EntityLinkResolverTag') {}

/** Maps a link target constructor to the repository adapter that loads it. */
export type EntityLinkRegistration = readonly [
  EntityConstructor<Entity>,
  Context.Context<EntityRepositoryTag>,
];

/**
 * Assembles an {@link EntityLinkResolverTag} context from repository adapters
 * that already exist. A repository requires nothing from its environment, so
 * neither does the resolver built from them.
 *
 * It lives here, beside the tag, rather than with React's `useEntityLinkResolver`
 * — which is only a `useMemo` around it — because nothing about it is React.
 * A server component that imported it from the React package would pull that
 * package's whole barrel, hooks included, and Next rejects `useState` reaching
 * a server module. Framework-free code belongs at a framework-free layer.
 */
export function createEntityLinkResolver(
  registrations: ReadonlyArray<EntityLinkRegistration>,
): Context.Context<EntityLinkResolverTag> {
  const repositoryByConstructor = new Map(
    registrations.map(
      ([entityConstructor, repositoryContext]) =>
        [
          entityConstructor,
          Context.get(repositoryContext, EntityRepositoryTag),
        ] as const,
    ),
  );

  const resolver: EntityLinkResolver = {
    resolve(entityConstructor, id) {
      const repository = repositoryByConstructor.get(
        entityConstructor as EntityConstructor<Entity>,
      );
      if (!repository) {
        return Effect.fail(
          new EntifixLogicError(
            `No link resolver registered for entity "${entityConstructor.name}"`,
            undefined,
            { entity: entityConstructor.name },
          ),
        );
      }
      return repository.get(id) as Effect.Effect<never, EntifixError>;
    },
  };

  return Context.make(EntityLinkResolverTag, resolver);
}
