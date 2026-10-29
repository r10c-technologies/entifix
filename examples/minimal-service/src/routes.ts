import { Book } from '@entifix/example-minimal-domain';
import { entityApi } from '@entifix/service-shell';

/**
 * One entity's CRUD over Postgres, and its `$metadata` — derived from the
 * entity and bound to the SQL repository factory the app layer provides.
 */
export const books = entityApi(Book, 'book', {
  verbs: ['list', 'get', 'create', 'update', 'delete'],
  guard: { kind: 'permission' },
});
