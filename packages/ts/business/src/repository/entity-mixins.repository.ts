import { Entity, EntityId, EntityLoadRequest } from '@entifix/core';
import { Context } from 'effect';

export class EntityIdTag extends Context.Service<EntityIdTag, EntityId>()(
  'EntityIdTag',
) {}

export class EntityLoadRequestTag extends Context.Service<
  EntityLoadRequestTag,
  EntityLoadRequest
>()('EntityLoadRequestTag') {}

export class EntityTag extends Context.Service<EntityTag, Entity>()(
  'EntityTag',
) {}
